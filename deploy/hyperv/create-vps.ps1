[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Mssv,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$IsoPath,

    [string]$VmDir = "C:\HyperV\VMs",
    [int]$MemoryGB = 2,
    [int]$CpuCount = 2,
    [int]$DiskGB = 20
)

$ErrorActionPreference = "Stop"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[ERROR] Administrator privileges are required. Please run PowerShell as Administrator." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command New-VM -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Hyper-V PowerShell module is not available. Enable Microsoft-Hyper-V-All first." -ForegroundColor Red
    exit 1
}

$hypervisorPresent = (Get-CimInstance -ClassName Win32_ComputerSystem).HypervisorPresent
if (-not $hypervisorPresent) {
    Write-Host "[ACTION REQUIRED] Hyper-V hypervisor is not active yet (HypervisorPresent = False)." -ForegroundColor Yellow
    Write-Host "                  hypervisorlaunchtype is already configured as Auto (or run .\setup-hyperv-network.ps1)." -ForegroundColor Yellow
    Write-Host "                  Please reboot Windows once, then re-run create-vps.ps1." -ForegroundColor Yellow
    exit 1
}

$trimmedMssv = $Mssv.Trim()
$sanitizedMssv = $trimmedMssv -replace '[^a-zA-Z0-9_-]', ''
if ([string]::IsNullOrWhiteSpace($sanitizedMssv) -or $sanitizedMssv -ne $trimmedMssv) {
    Write-Host "[ERROR] Invalid -Mssv '$Mssv'. Use only letters, digits, '-' or '_' (no spaces or special characters)." -ForegroundColor Red
    exit 1
}
$vmName = "vps-$sanitizedMssv"

if (-not (Test-Path -LiteralPath $IsoPath -PathType Leaf)) {
    Write-Host "[ERROR] Ubuntu ISO file not found at: $IsoPath" -ForegroundColor Red
    exit 1
}
$resolvedIsoPath = (Resolve-Path -LiteralPath $IsoPath).Path

if ($MemoryGB -lt 1 -or $CpuCount -lt 1 -or $DiskGB -lt 10) {
    Write-Host "[ERROR] Invalid VM sizing: MemoryGB >= 1, CpuCount >= 1, DiskGB >= 10 are required." -ForegroundColor Red
    exit 1
}

$fullVmDir = [System.IO.Path]::GetFullPath($VmDir)
$rootPath = [System.IO.Path]::GetPathRoot($fullVmDir)
$driveLetter = $rootPath.TrimEnd(':\')
$psDrive = Get-PSDrive -Name $driveLetter -PSProvider FileSystem -ErrorAction SilentlyContinue
if (-not $psDrive) {
    Write-Host "[ERROR] Target drive '${driveLetter}:' for VmDir '$VmDir' was not found." -ForegroundColor Red
    exit 1
}
$freeGB = [math]::Round($psDrive.Free / 1GB, 2)
if ($psDrive.Free -lt 15GB) {
    Write-Host "[ERROR] Insufficient free disk space on drive ${driveLetter}: (${freeGB} GB free, minimum 15 GB required)." -ForegroundColor Red
    exit 1
}

if (Get-VM -Name $vmName -ErrorAction SilentlyContinue) {
    Write-Host "[ERROR] Hyper-V VM '$vmName' already exists. Remove it first or choose a different -Mssv." -ForegroundColor Red
    exit 1
}

$switchName = "vSwitch-CloudLab"
if (-not (Get-VMSwitch -Name $switchName -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Hyper-V switch '$switchName' does not exist. Run .\setup-hyperv-network.ps1 first." -ForegroundColor Red
    exit 1
}

$vmSubDir = Join-Path $fullVmDir $vmName
$vhdxPath = Join-Path $vmSubDir "$vmName.vhdx"
if (Test-Path -LiteralPath $vhdxPath) {
    Write-Host "[ERROR] VHDX file already exists at '$vhdxPath'." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $vmSubDir)) {
    New-Item -ItemType Directory -Path $vmSubDir -Force | Out-Null
}

$memoryBytes = [int64]$MemoryGB * 1GB
$diskBytes = [uint64]$DiskGB * 1GB

Write-Host "[1/5] Creating Hyper-V Gen 2 VM '$vmName' ($CpuCount vCPU, ${MemoryGB}GB RAM, ${DiskGB}GB Dynamic VHDX)..." -ForegroundColor Cyan
New-VM -Name $vmName `
    -MemoryStartupBytes $memoryBytes `
    -Generation 2 `
    -Path $fullVmDir `
    -NewVHDPath $vhdxPath `
    -NewVHDSizeBytes $diskBytes `
    -SwitchName $switchName | Out-Null

Write-Host "[2/5] Configuring fixed memory and vCPU count..." -ForegroundColor Cyan
Set-VMMemory -VMName $vmName -DynamicMemoryEnabled $false -StartupBytes $memoryBytes
Set-VM -Name $vmName -ProcessorCount $CpuCount -StaticMemory

Write-Host "[3/5] Attaching Ubuntu ISO and configuring Gen 2 UEFI Secure Boot..." -ForegroundColor Cyan
$dvdDrive = Add-VMDvdDrive -VMName $vmName -Path $resolvedIsoPath -Passthru
$hddDrive = Get-VMHardDiskDrive -VMName $vmName
Set-VMFirmware -VMName $vmName `
    -EnableSecureBoot On `
    -SecureBootTemplate "MicrosoftUEFICertificateAuthority" `
    -BootOrder @($dvdDrive, $hddDrive)

Write-Host "[4/5] Creating initial clean Hyper-V checkpoint..." -ForegroundColor Cyan
Checkpoint-VM -Name $vmName -SnapshotName "Initial-Clean"

Write-Host "[5/5] Verifying provisioned VM..." -ForegroundColor Cyan
Get-VM -Name $vmName | Format-Table Name, State, Generation, ProcessorCount, MemoryAssigned, Status -AutoSize

Write-Host @"

=== VM '$vmName' Provisioned Successfully ===
VHDX Path : $vhdxPath
Switch    : $switchName
ISO       : $resolvedIsoPath

Next Steps:
1. Start the VM and open Hyper-V console:
   Start-VM -Name "$vmName"
   vmconnect localhost "$vmName"

2. During Ubuntu Server 24.04 LTS installation, set Manual IPv4 (or configure /etc/netplan/50-cloud-init.yaml):
   Subnet  : 192.168.100.0/24
   Address : 192.168.100.10
   Gateway : 192.168.100.1
   DNS     : 8.8.8.8,1.1.1.1

   Example /etc/netplan/00-installer-config.yaml:
     network:
       version: 2
       ethernets:
         eth0:
           dhcp4: false
           addresses:
             - 192.168.100.10/24
           routes:
             - to: default
               via: 192.168.100.1
           nameservers:
             addresses: [8.8.8.8, 1.1.1.1]

3. After Ubuntu finishes installing and OpenSSH Server is running, copy and deploy from Windows:
   scp -r C:\WebDocTruyen\mangastore-vps <ubuntu_user>@192.168.100.10:/tmp/mangastore-vps
   ssh <ubuntu_user>@192.168.100.10 "sudo mkdir -p /opt/mangastore-vps && sudo cp -a /tmp/mangastore-vps/. /opt/mangastore-vps/ && sudo bash /opt/mangastore-vps/deploy/ubuntu/setup-vps.sh"
   ssh <ubuntu_user>@192.168.100.10 "sudo bash /opt/mangastore-vps/deploy/ubuntu/verify-vps.sh"
"@ -ForegroundColor Green
