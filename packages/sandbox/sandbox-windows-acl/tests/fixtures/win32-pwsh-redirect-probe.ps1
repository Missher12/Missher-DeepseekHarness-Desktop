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

  # 3. npm.ps1 through the real script path and its resolved prefix.
  #
  # npm's shim rebuilds its argv from `$MyInvocation.Line` when that line exists:
  # it parses the invocation expression and voices `CommandElements.Skip(1)`
  # through Invoke-Expression. Calling it with this script's own call operator
  # (`& $npmCommand.Source prefix`) therefore hands the shim the *text*
  # `$npmCommand.Source` and npm reports `Unknown command`. Starting it as a
  # child with `-File` leaves `$MyInvocation.Line` empty, so the shim takes its
  # `$args` branch and receives exactly `prefix`. npm.cmd is not used.
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($null -eq $npmCommand) { throw 'npm is not resolvable from the confined PowerShell' }
  $npmScriptPath = [string]$npmCommand.Source
  $evidence.npmScript = [ordered]@{
    commandType = [string]$npmCommand.CommandType
    source = $npmScriptPath
    isScript = ($npmScriptPath -like '*.ps1')
    sha256 = if (Test-Path -LiteralPath $npmScriptPath) { (Get-FileHash -LiteralPath $npmScriptPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    invocation = 'pwsh -File <resolved npm.ps1> prefix'
  }
  if (-not $evidence.npmScript.isScript) { throw "npm did not resolve to a .ps1 script: $npmScriptPath" }
  $pwshExe = (Get-Process -Id $PID).Path
  # The same Stopwatch budget covers this phase: the PSI redirect and the npm
  # call together stay inside the single 30 s deadline, so the probe can still
  # write its evidence before the runner's 60 s teardown.
  $npmStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $npmStartInfo.FileName = $pwshExe
  # ArgumentList takes one argument per Add. Start-Process -ArgumentList joins
  # its array into one command line, which splits a resolved path containing
  # spaces; adding each item here keeps the real script path intact.
  foreach ($npmArg in @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $npmScriptPath, 'prefix')) {
    $npmStartInfo.ArgumentList.Add($npmArg)
  }
  $npmStartInfo.UseShellExecute = $false
  $npmStartInfo.RedirectStandardOutput = $true
  $npmStartInfo.RedirectStandardError = $true
  $npmStartInfo.CreateNoWindow = $true
  $npmChild = $null
  try {
    $npmChild = [System.Diagnostics.Process]::Start($npmStartInfo)
    # Bounded capture, same buffers and cap as the PSI phase.
    $npmOutBuffer = New-Object char[] $maxChars
    $npmErrBuffer = New-Object char[] $maxChars
    $npmOutTask = $npmChild.StandardOutput.ReadAsync($npmOutBuffer, 0, $maxChars)
    $npmErrTask = $npmChild.StandardError.ReadAsync($npmErrBuffer, 0, $maxChars)
    if (-not $npmOutTask.Wait((Get-RemainingBudget))) { throw 'reading npm.ps1 stdout timed out within the shared budget' }
    if (-not $npmErrTask.Wait((Get-RemainingBudget))) { throw 'reading npm.ps1 stderr timed out within the shared budget' }
    if (-not $npmChild.WaitForExit((Get-RemainingBudget))) { throw 'npm.ps1 did not exit within the shared budget' }
    $npmOutCount = $npmOutTask.Result
    $npmErrCount = $npmErrTask.Result
    $prefixText = ([string]::new($npmOutBuffer, 0, [Math]::Max($npmOutCount, 0))).Trim()
    $prefixErrorText = ([string]::new($npmErrBuffer, 0, [Math]::Max($npmErrCount, 0))).Trim()
    $prefixExit = $npmChild.ExitCode
  } finally {
    # This probe owns only the npm child it started: a kill that does not
    # settle is a visible cleanup failure, never reported as completion.
    if ($null -ne $npmChild) {
      if (-not $npmChild.HasExited) {
        try { $npmChild.Kill($true) } catch {
          $evidence.cleanupFailures.Add("npm.ps1 kill: $($_.Exception.Message)")
        }
        if (-not $npmChild.HasExited) {
          try {
            if (-not $npmChild.WaitForExit(5000)) { $evidence.cleanupFailures.Add('npm.ps1 kill: the child did not exit within 5 s') }
          } catch {
            $evidence.cleanupFailures.Add("npm.ps1 kill wait: $($_.Exception.Message)")
          }
        }
      }
      $npmChild.Dispose()
    }
  }
  if ($prefixExit -ne 0) {
    throw "npm.ps1 prefix exited $prefixExit`: $prefixText $prefixErrorText"
  }
  $prefixValue = (($prefixText -split "`r?`n") | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)
  $evidence.npmPrefix = [ordered]@{
    value = ([string]$prefixValue).Trim()
    exitCode = $prefixExit
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
