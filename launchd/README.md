`install.sh` writes `~/Library/LaunchAgents/com.com-factory.panel.plist` (RunAtLoad + KeepAlive). Manage it with:

```
launchctl kickstart -k gui/$(id -u)/com.com-factory.panel   # restart
launchctl bootout gui/$(id -u)/com.com-factory.panel        # stop & unload
tail -f data/com-factory.log
```
