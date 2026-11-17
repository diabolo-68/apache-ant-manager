@echo off
rem Writes its first argument to batch.out in the current directory (checked by the tests).
echo Building %~1
> batch.out echo Building %~1
