# Windows Test Matrix

Last updated: 2026-02-18

## Goal

Validate that setup, onboarding, and background runtime work on:
- Windows 10 (build 19041+)
- Windows 11

## Environments

1. Windows 10 Pro 22H2 (build 19045.x)
2. Windows 11 Pro 23H2/24H2 (build 22631+/26100+)

Use clean VMs for each run:
- no WSL
- no Node.js
- no OpenClaw
- default Windows Defender settings

## Pre-flight checks

1. Virtualization enabled in BIOS/host.
2. VM user has admin rights.
3. Stable internet access.
4. Snapshot VM before install.

## Test cases

1. Installer flow
- Install `.exe`.
- Launch app.
- Verify app opens with Setup workspace.

2. WSL elevated install + reboot resume
- Start guided setup.
- Accept UAC prompt.
- If reboot requested, reboot.
- Verify app resumes setup state after login.

3. OpenClaw install in WSL
- Verify OpenClaw install step completes.
- Verify `OpenClaw CLI` status becomes `Installed`.

4. Onboarding in app
- Start wizard.
- Complete provider/model/auth steps.
- Complete channel setup (WhatsApp or Telegram).
- Verify wizard reaches done state.

5. Gateway lifecycle
- Start gateway.
- Confirm `Gateway` status is `Running`.
- Stop gateway.
- Confirm `Gateway` status is `Stopped`.

6. Tray + close-to-tray behavior
- Close main window.
- Verify app remains in tray.
- Use tray actions:
  - Gateway Status
  - Start Gateway
  - Stop Gateway
- Reopen app from tray menu.

7. Always-on gateway (task scheduler)
- Enable `Always on (sign-in)`.
- Sign out/in.
- Verify scheduled task exists and gateway can auto-start.
- Disable and confirm task is removed.

8. Channel management page
- Refresh channel status.
- Reconnect Telegram/WhatsApp.
- Disable channel and confirm state updates.

9. Model management page
- Apply new provider/model.
- Verify current model status reflects change.

10. Telegram helper UX
- Copy BotFather link and `/newbot`.
- Save valid token.
- Verify token validation catches invalid format.

11. Auto-update UX (packaged build with publish feed configured)
- Run `Check`.
- Verify state transitions (checking, available/downloading/downloaded or no update).
- If downloaded, click `Install + Restart` and confirm relaunch.

## Pass criteria

Release candidate is acceptable when:
1. All critical flows pass on both Windows 10 and Windows 11.
2. No blocker issue in setup, onboarding, tray control, or gateway runtime.
3. No data-loss or unrecoverable states after reboot/sign-in resume.

## Known constraints

1. Windows 10 below build 19041 may not support seamless WSL install flow.
2. Auto-update requires packaged app + configured publish provider.
