[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[ERROR] Administrator privileges are required. Please run PowerShell as Administrator." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command Get-VMSwitch -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Hyper-V PowerShell module is not available. Enable Microsoft-Hyper-V-All first." -ForegroundColor Red
    exit 1
}

$switchName = "vSwitch-CloudLab"
$adapterAlias = "vEthernet ($switchName)"
$gatewayIp = "192.168.100.1"
$prefixLength = 24
$natName = "NAT-CloudLab"
$natSubnet = "192.168.100.0/24"

Write-Host "[1/4] Checking Hyper-V Internal Switch '$switchName'..." -ForegroundColor Cyan
$vmSwitch = Get-VMSwitch -Name $switchName -ErrorAction SilentlyContinue
if (-not $vmSwitch) {
    $vmSwitch = New-VMSwitch -Name $switchName -SwitchType Internal
    Write-Host "  Created VMSwitch '$switchName' (Internal)." -ForegroundColor Green
} else {
    Write-Host "  VMSwitch '$switchName' already exists ($($vmSwitch.SwitchType))." -ForegroundColor Yellow
}

Write-Host "[2/4] Waiting for virtual adapter '$adapterAlias' and configuring IP $gatewayIp/$prefixLength..." -ForegroundColor Cyan
$adapterFound = $false
for ($i = 0; $i -lt 20; $i++) {
    if (Get-NetAdapter -Name $adapterAlias -ErrorAction SilentlyContinue) {
        $adapterFound = $true
        break
    }
    Start-Sleep -Milliseconds 500
}
if (-not $adapterFound) {
    Write-Host "[ERROR] Virtual network adapter '$adapterAlias' did not appear in time." -ForegroundColor Red
    exit 1
}

$existingIp = Get-NetIPAddress -InterfaceAlias $adapterAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq $gatewayIp -and $_.PrefixLength -eq $prefixLength }
if (-not $existingIp) {
    New-NetIPAddress -IPAddress $gatewayIp -PrefixLength $prefixLength -InterfaceAlias $adapterAlias | Out-Null
    Write-Host "  Assigned IP $gatewayIp/$prefixLength to '$adapterAlias'." -ForegroundColor Green
} else {
    Write-Host "  IP $gatewayIp/$prefixLength is already assigned to '$adapterAlias'." -ForegroundColor Yellow
}

Write-Host "[3/4] Checking Windows NAT '$natName' ($natSubnet)..." -ForegroundColor Cyan
$netNat = Get-NetNat -Name $natName -ErrorAction SilentlyContinue
if (-not $netNat) {
    $netNat = New-NetNat -Name $natName -InternalIPInterfaceAddressPrefix $natSubnet
    Write-Host "  Created NetNat '$natName' for $natSubnet." -ForegroundColor Green
} else {
    Write-Host "  NetNat '$natName' already exists ($($netNat.InternalIPInterfaceAddressPrefix))." -ForegroundColor Yellow
}

Write-Host "[4/4] Setting hypervisorlaunchtype to Auto via bcdedit..." -ForegroundColor Cyan
& bcdedit /set hypervisorlaunchtype auto | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to execute 'bcdedit /set hypervisorlaunchtype auto'." -ForegroundColor Red
    exit $LASTEXITCODE
}

$hypervisorPresent = (Get-CimInstance -ClassName Win32_ComputerSystem).HypervisorPresent
$bcdState = (& bcdedit /enum "{current}" | Select-String -Pattern "hypervisorlaunchtype").ToString().Trim()

Write-Host "`n=== Hyper-V Host Network & Boot Summary ===" -ForegroundColor Cyan
Get-VMSwitch -Name $switchName | Format-Table Name, SwitchType, Id -AutoSize
Get-NetIPAddress -InterfaceAlias $adapterAlias -AddressFamily IPv4 | Format-Table InterfaceAlias, IPAddress, PrefixLength, AddressState -AutoSize
Get-NetNat -Name $natName | Format-Table Name, InternalIPInterfaceAddressPrefix, Active -AutoSize
Write-Host "Boot Config         : $bcdState"
Write-Host "Hypervisor Active   : $hypervisorPresent"

if (-not $hypervisorPresent) {
    Write-Host "`n[NOTICE] Hyper-V hypervisor is not active in the current Windows session." -ForegroundColor Yellow
    Write-Host "         'hypervisorlaunchtype' is set to Auto. Please restart Windows once manually before creating/starting VMs." -ForegroundColor Yellow
} else {
    Write-Host "`n[OK] Hyper-V host network and hypervisor are ready." -ForegroundColor Green
}
