@echo off
title BioOS - Symbiotic Boot
echo ===================================================
echo      BioOS v0.8 - ORGANIC BOOT SEQUENCE
echo ===================================================
echo [1/3] Activating Neural Network (Supervisor)...
start /b build\metaspace_supervisor.exe

echo [2/3] Establishing Logic Bridge (Bio-Gate)...
start /b BIO_OS_PROJECT\bio_gate.exe

echo [3/3] Opening Visual Interface (Dashboard)...
echo BioOS IS NOW ACTIVE AND EVOLVING.
echo ===================================================
python BIO_OS_PROJECT\bio_dashboard.py
pause
