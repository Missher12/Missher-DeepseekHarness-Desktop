# PowerShell redirect evidence for the confined Windows lane.
#
# Runs inside the ACL-confined child the runner spawns, so the real restricted
# token and the real PowerShell 7.6.6 / .NET runtime execute it. Reports one JSON
# object with:
#   - the .NET runtime actually executing this script (FrameworkDescription);
#   - a System.Diagnostics.ProcessStartInfo redirect of a child (stdout, stderr,
#     exit code), the .NET path that raised NativeErrorCode=5 in production;
#   - the npm.ps1 script and the prefix it resolves, invoked through that path
#     (never npm.cmd and never a bare --version check).
# The exit code is 0 only when every item reports success.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
$evidence = [ordered]@{
  frameworkDescription = $null
  processStartInfo = $null
  npmScript = $null
  npmPrefix = $null
  failure = $null
  cleanupFailures = [System.Collections.Generic.List[string]]::new()
  ok = $false
}

try {
  # 1. The runtime that is executing this script.
  $evidence.frameworkDescription = [System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription

  # 2. ProcessStartInfo redirection: the exact .NET surface whose CreatePipe
  #    step failed in production. Uses the current PowerShell as the child.
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Process -Id $PID).Path
  $psi.ArgumentList.Add('-NoLogo')
  $psi.ArgumentList.Add('-NoProfile')
  $psi.ArgumentList.Add('-NonInteractive')
  $psi.ArgumentList.Add('-Command')
  $psi.ArgumentList.Add('Write-Output "PSI_STDOUT_OK"; [Console]::Error.WriteLine("PSI_STDERR_OK"); exit 7')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $false
  $psi.CreateNoWindow = $true
  # Bounded capture: these streams are markers, not logs; a runaway child must
  # not grow the evidence without bound.
  $maxChars = 4096
  $child = $null
  # One shared 30 s deadline for the whole redirected round trip: reads and exit
  # consume the same budget, so the worst case stays below the runner's 60 s
  # teardown and the probe can still write its own failure JSON.
  $deadline = [System.Diagnostics.Stopwatch]::StartNew()
  $budgetMs = 30000
  function Get-RemainingBudget {
    $remaining = $budgetMs - $deadline.ElapsedMilliseconds
    if ($remaining -le 0) { throw "the redirected child exceeded its ${budgetMs} ms budget" }
    return [int]$remaining
  }
  try {
    $child = [System.Diagnostics.Process]::Start($psi)
    # Read one bounded buffer instead of ReadToEnd: the markers sit at the head.
    $outBuffer = New-Object char[] $maxChars
    $errBuffer = New-Object char[] $maxChars
    $readTask = $child.StandardOutput.ReadAsync($outBuffer, 0, $maxChars)
    $errTask = $child.StandardError.ReadAsync($errBuffer, 0, $maxChars)
    if (-not $readTask.Wait((Get-RemainingBudget))) { throw 'reading the redirected stdout timed out within the shared budget' }
    if (-not $errTask.Wait((Get-RemainingBudget))) { throw 'reading the redirected stderr timed out within the shared budget' }
    if (-not $child.WaitForExit((Get-RemainingBudget))) { throw 'the redirected child did not exit within the shared budget' }
    $outCount = $readTask.Result
    $errCount = $errTask.Result
    if (-not $child.HasExited) { throw 'the redirected child did not exit' }
    $stdout = ([string]::new($outBuffer, 0, [Math]::Max($outCount, 0))).Trim()
    $stderr = ([string]::new($errBuffer, 0, [Math]::Max($errCount, 0))).Trim()
    $evidence.processStartInfo = [ordered]@{
      exitCode = $child.ExitCode
      stdout = $stdout
      stderr = $stderr
      redirect = $true
    }
  } finally {
    # Only the child this probe started is touched; the runner's Job still owns
    # the confined tree. A kill that does not settle is a visible cleanup
    # failure, never silently dropped.
    if ($null -ne $child) {
      if (-not $child.HasExited) {
        try { $child.Kill($true) } catch {
          $evidence.cleanupFailures.Add("kill: $($_.Exception.Message)")
        }
        if (-not $child.HasExited) {
          try {
            if (-not $child.WaitForExit(5000)) { $evidence.cleanupFailures.Add('kill: the child did not exit within 5 s') }
          } catch {
            $evidence.cleanupFailures.Add("kill wait: $($_.Exception.Message)")
          }
        }
      }
      $child.Dispose()
    }
  }

  # 3. npm.ps1 through the real script path and its resolved prefix. The shim
  #    differs from npm.cmd; this records the script a confined pwsh actually
  #    finds and the prefix it would use.
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($null -eq $npmCommand) { throw 'npm is not resolvable from the confined PowerShell' }
  $evidence.npmScript = [ordered]@{
    commandType = [string]$npmCommand.CommandType
    source = [string]$npmCommand.Source
    isScript = ($npmCommand.Source -like '*.ps1')
  }
  if (-not $evidence.npmScript.isScript) { throw "npm did not resolve to a .ps1 script: $($evidence.npmScript.source)" }
  $prefix = & $npmCommand.Source prefix 2>&1
  if ($LASTEXITCODE -ne 0) { throw "npm.ps1 prefix exited $LASTEXITCODE`: $prefix" }
  $evidence.npmPrefix = [ordered]@{
    value = ([string]($prefix | Select-Object -Last 1)).Trim()
    exitCode = $LASTEXITCODE
  }

  $evidence.ok = (
    $null -ne $evidence.frameworkDescription -and
    $null -ne $evidence.processStartInfo -and
    $evidence.processStartInfo.exitCode -eq 7 -and
    $evidence.processStartInfo.stdout -eq 'PSI_STDOUT_OK' -and
    $evidence.processStartInfo.stderr -eq 'PSI_STDERR_OK' -and
    $evidence.processStartInfo.redirect -eq $true -and
    $null -ne $evidence.npmScript -and
    $evidence.npmScript.isScript -eq $true -and
    $null -ne $evidence.npmPrefix -and
    $evidence.npmPrefix.exitCode -eq 0 -and
    [string]::IsNullOrWhiteSpace([string]$evidence.npmPrefix.value) -eq $false -and
    $evidence.cleanupFailures.Count -eq 0
  )
  if (-not $evidence.ok) { throw 'the redirect evidence did not match the expected markers' }
} catch {
  $evidence.failure = $_.Exception.Message
} finally {
  $evidence | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -Path $OutFile
}

if (-not $evidence.ok) { exit 1 }
