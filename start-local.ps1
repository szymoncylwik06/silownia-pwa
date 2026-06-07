param(
  [switch]$Lan
)

$Port = 4217
$BindAddress = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
$ProbeAddress = if ($Lan) { [System.Net.IPAddress]::Any } else { [System.Net.IPAddress]::Loopback }

$Probe = [System.Net.Sockets.TcpListener]::new($ProbeAddress, $Port)
try {
  $Probe.Start()
  $Probe.Stop()
} catch {
  Write-Error "Port $Port is already busy. This project is configured to avoid reserved ports, so stop the other process or change `$Port in start-local.ps1."
  exit 1
}

Write-Host "Silownia local server"
Write-Host "Port: $Port"
Write-Host "Bind: $BindAddress"
Write-Host ""

if ($Lan) {
  Write-Host "LAN URL: http://ADRES-IP-KOMPUTERA:$Port/"
} else {
  Write-Host "Local URL: http://127.0.0.1:$Port/"
}

python -m http.server $Port --bind $BindAddress
