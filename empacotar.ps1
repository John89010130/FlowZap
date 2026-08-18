$dest = "C:\Users\TID-ERIC\Desktop\VisualCode\CopiaCRM\FlowZap_Motor_Cliente"
$src = "C:\Users\TID-ERIC\Desktop\VisualCode\CopiaCRM\src-backend"
$nodePath = "C:\nvm4w\nodejs\node.exe"

Write-Host "Limpando pasta antiga..."
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path "$dest"

Write-Host "Copiando Node.js Embutido..."
Copy-Item $nodePath -Destination "$dest\node.exe"

Write-Host "Iniciando ofuscação de codigo JavaScript e Injetando de Chaves..."
# The script takes the destination root and saves it to root/src
node.exe "$src\build_obfuscated.js" "$dest\src"

Write-Host "Copiando Restante (Manifestos e Modulos)..."
Copy-Item "$src\package.json" -Destination "$dest\src\package.json"

Write-Host "Copiando Dependências (Isso pode demorar alguns segundos)..."
Copy-Item "$src\node_modules" -Destination "$dest\src\node_modules" -Recurse -Force

# Note that we DO NOT copy .env or .env.example at all for the client anymore.

Write-Host "Criando o Launcher do Cliente..."
$launcherCode = @"
@echo off
title FlowZap Motor Backend (API)
color 0A
mode con: cols=100 lines=30

echo.
echo =========================================================
echo            🚀 LIGANDO O MOTOR DO FLOWZAP 🚀
echo =========================================================
echo.
echo Processando os arquivos brutos (Versao Portable)...
echo Código ofuscado ativado por seguranca.
echo.

node.exe src\server.js

echo.
echo [AVISO] O Motor de IA foi desligado ou encontrou um erro!
echo Olhe o log acima para ver o que aconteceu.
pause
"@
Set-Content -Path "$dest\🚀 Ligar_Servidor_Motor.bat" -Value $launcherCode -Encoding UTF8

Write-Host "Compactando a versão final em ZIP..."
$zipPath = "C:\Users\TID-ERIC\Desktop\VisualCode\CopiaCRM\FlowZap_Motor_Cliente_ProntoParaEnvio.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Compress-Archive -Path "$dest\*" -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "✅ SUCESSO ABSOLUTO! O Motor.zip blindado e ofuscado está na Area de Trabalho: $zipPath"
