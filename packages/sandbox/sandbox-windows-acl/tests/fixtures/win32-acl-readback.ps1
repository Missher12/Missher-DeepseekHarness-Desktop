# Read DACL | LABEL security information for one or more objects and emit one JSON
# document. Only the outermost ConvertTo-Json serializes.
#
#   pwsh -File win32-acl-readback.ps1 -PathsJson '["C:\\a","C:\\b"]' -OutFile out.json
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PathsJson,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
# DACL_SECURITY_INFORMATION = 0x4, LABEL_SECURITY_INFORMATION = 0x10.
$DaclInformation = 0x00000004
$LabelInformation = 0x00000010
$FileObject = 1

# One complete type: the whole namespace/class lives in TypeDefinition.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AclProbe {
  public static class Native {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern uint GetNamedSecurityInfoW(string name, int objectType, uint info,
      IntPtr owner, IntPtr group, out IntPtr dacl, IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr descriptor,
      uint revision, uint info, out IntPtr text, out uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LocalFree(IntPtr memory);
  }
}
'@ | Out-Null

# WM / ML ACE SID aliases the SDDL uses for the mandatory label.
$LabelSidAliases = @{ LW = 'S-1-16-4096'; ME = 'S-1-16-8192'; HI = 'S-1-16-12288'; SI = 'S-1-16-16384' }

$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rows = @()
foreach ($path in ($PathsJson | ConvertFrom-Json)) {
  $dacl = [IntPtr]::Zero
  $descriptor = [IntPtr]::Zero
  $text = [IntPtr]::Zero
  $row = [ordered]@{
    path = $path; win32 = 0; read = $false; sddl = $null; labelSid = $null; labelMask = $null;
    freeErrors = @(); aces = @(); userSid = $userSid
  }
  $freeErrors = [System.Collections.Generic.List[string]]::new()
  try {
    $code = [AclProbe.Native]::GetNamedSecurityInfoW($path, $FileObject,
      ($DaclInformation -bor $LabelInformation), [IntPtr]::Zero, [IntPtr]::Zero, [ref]$dacl, [IntPtr]::Zero, [ref]$descriptor)
    $row.win32 = [int]$code
    if ($code -ne 0) { continue }
    $length = 0
    if (-not [AclProbe.Native]::ConvertSecurityDescriptorToStringSecurityDescriptorW($descriptor, 1,
        ($DaclInformation -bor $LabelInformation), [ref]$text, [ref]$length)) {
      $row.win32 = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      continue
    }
    $sddl = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($text)
    $row.sddl = $sddl
    # Mandatory label ACE: (ML;flags;rights;objectGUID;inheritGUID;SID). It is the
    # only ML ACE type, so a SACL control-flag prefix such as `S:AI` or `S:NO` is
    # tolerated and the DACL's (A;…)/(D;…) ACEs can never match.
    if ($sddl -match '\(ML;([^;]*);([^;]*);([^;]*);([^;]*);([^)]*)\)') {
      $labelRights = $Matches[2]
      $labelToken = $Matches[5]
      $row.labelMask = $labelRights
      $row.labelSid = if ($LabelSidAliases.ContainsKey($labelToken)) { $LabelSidAliases[$labelToken] } else { $labelToken }
    }
    # DACL ACEs keep their real order and exact SIDs.
    $acl = Get-Acl -LiteralPath $path -ErrorAction Stop
    $row.aces = @($acl.Access | ForEach-Object {
      [pscustomobject]@{
        type = "$($_.AccessControlType)"
        rights = "$($_.FileSystemRights)"
        sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        inherited = $_.IsInherited
      }
    })
    $row.read = $true
  } catch {
    if (-not $row.win32) { $row.win32 = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() }
  } finally {
    if ($text -ne [IntPtr]::Zero -and [AclProbe.Native]::LocalFree($text) -ne [IntPtr]::Zero) {
      $freeErrors.Add('text')
    }
    if ($descriptor -ne [IntPtr]::Zero -and [AclProbe.Native]::LocalFree($descriptor) -ne [IntPtr]::Zero) {
      $freeErrors.Add('descriptor')
    }
    $row.freeErrors = @($freeErrors)
    if ($freeErrors.Count -gt 0) { $row.read = $false }
    $rows += [pscustomobject]$row
  }
}
# A BOM is tolerated by the TypeScript reader; do not add a fake-pass path.
$rows | ConvertTo-Json -Depth 6 -Compress | Set-Content -Encoding utf8 -Path $OutFile
