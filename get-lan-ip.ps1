# get-lan-ip.ps1 — 获取当前活动网卡的内网 IPv4 地址
# 优先选择有默认网关且网卡状态为 Up 的网卡（通常是真正连网的那块）
$ip = (Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1).IPv4Address.IPAddress

# 若未找到，回退到任意非回环 IPv4 地址
if (-not $ip) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1).IPAddress
}

# 最终回退到本机回环
if (-not $ip) { $ip = '127.0.0.1' }

Write-Output $ip