# FIRST BUILD BLOCKER: http_server.h stray '\'

## Issue
```
D:/template/esp32/main/http/http_server.h:15:1: error: stray '\' in program
   15 | \n#ifdef __cplusplus
```

## Root Cause
The `\n` character was a literal backslash followed by 'n', inserted accidentally during automated string replacement by an AI agent in a previous safe point.

## Evidence & Git History
`git log -p` and `git blame` revealed the literals were introduced in commit `98f36f4c` ("SP-REMED-008: Authentication & Security") by author DIAN SOBANA. The commit diff showed `\n#ifdef __cplusplus` being injected at both the top and bottom of the file.

## Minimal Fix
Replaced the literal `\n` string with an actual newline on lines 15 and 60 in `esp32/main/http/http_server.h`. No structural or architectural changes were made. (Note: other files like `api_cropcycle_handlers.c` appear to have similar corruption from the same commit, but following the "jangan menebak" rule, only the blocking file was fixed).

## Build Result
Running `idf.py build` confirmed `http_server.h` compiles successfully. The compiler moved forward and began compiling `main.c` and other HAL components until it hit the next blocker in `storage_mgr.c`.

## Next Blocker
```
D:/template/esp32/main/storage/storage_mgr.c: In function 'storage_mgr_append_event_log':
D:/template/esp32/main/storage/storage_mgr.c:206:9: error: implicit declaration of function 'unlink' [-Wimplicit-function-declaration]
```

## SAFE POINT
FIRST-BUILD-BLOCKER-http-server
