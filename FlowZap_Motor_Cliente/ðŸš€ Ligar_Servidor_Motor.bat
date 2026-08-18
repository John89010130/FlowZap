@echo off
title FlowZap Motor Backend (API)
color 0A
mode con: cols=100 lines=30

echo.
echo =========================================================
echo            ðŸš€ LIGANDO O MOTOR DO FLOWZAP ðŸš€
echo =========================================================
echo.
echo Processando os arquivos brutos (Versao Portable)...
echo CÃ³digo ofuscado ativado por seguranca.
echo.

node.exe src\server.js

echo.
echo [AVISO] O Motor de IA foi desligado ou encontrou um erro!
echo Olhe o log acima para ver o que aconteceu.
pause
