$r = Invoke-RestMethod -Uri "http://192.168.0.101/api/v1/calibration" -Method POST -Body '{"componentId":"pump_submersible","type":"VOLUMETRIC","duration_sec":3}' -ContentType 'application/json'
Write-Host "STARTED:" ($r | ConvertTo-Json -Compress)

for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Milliseconds 500
    $st = (Invoke-RestMethod -Uri "http://192.168.0.101/api/v1/calibration/status").data
    $act = (Invoke-RestMethod -Uri "http://192.168.0.101/api/v1/status").data.actuators
    Write-Host "t=$($i * 0.5)s | state=$($st.state) rem=$($st.remaining_sec) | rawSubmersible=$($act.rawSubmersible)"
}
