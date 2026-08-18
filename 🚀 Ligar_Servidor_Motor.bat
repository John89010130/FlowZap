@echo off
title FlowZap Motor Backend (API)
color 0A
mode con: cols=100 lines=30

echo.
echo =========================================================
echo            🚀 LIGANDO O MOTOR DO FLOWZAP 🚀
echo =========================================================
echo.
echo Processando os arquivos brutos (Sem compilador PKG)...
echo Isso garante mais velocidade e previne telas pretas.
echo.

cd src-backend 2>nul
if errorlevel 1 (
    if exist server.js (
        rem Ja estamos na pasta certa
    ) else (
        echo [ERRO] Pasta src-backend nao encontrada!
        pause
        exit /b
    )
)

echo Iniciando o Servidor Local...
node server.js

echo.
echo [AVISO] O Motor de IA foi desligado ou encontrou um erro!
echo Olhe o log acima para ver o que aconteceu.
pause
