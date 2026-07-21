# Turn on the nightly memory jobs (your hand-holding guide)

You do two things. I have automated everything else. This should take about two minutes.

## Why this is needed (in one breath)

The nightly jobs run a background `claude` with no human watching. A background claude has no way to log in on its own. So you create a long-lived login token ONCE, hand it to a script, and the jobs run themselves forever after.

The token comes from a real, official Claude Code command: `claude setup-token`. I checked: `claude setup-token --help` says "Set up a long-lived authentication token (requires Claude subscription)." So this only works if you are on a Claude paid plan (Pro or Max), which you are.

## Step 1: make the token

Open the Terminal app. Type this exact line and press return:

```
/usr/local/bin/claude setup-token
```

(The full path matters so you run the real binary directly. This command only does a login, it does not touch your API keys.)

What happens next:
- It will either open your web browser, or print a link for you to open.
- In the browser, log in with your Claude account and click Authorize / Allow.
- Back in the Terminal, it prints a token. It is a long string. It may start with `sk-ant-oat` or similar.

Select and copy that whole token string.

If instead it says something about needing a subscription and you are sure you have one, tell me and we will sort out the login another way.

## Step 2: hand the token to the script

In the Terminal, go to the AI-OS folder and run the helper with your token pasted in:

```
cd ~/AI-OS
bash scripts/enable-cron.sh PASTE_YOUR_TOKEN_HERE
```

Replace `PASTE_YOUR_TOKEN_HERE` with the token you copied (keep it on the same line).

That script does ALL the rest by itself:
1. Saves the token to `~/.config/claude-code-oauth-token` (locked to your user, chmod 600).
2. Loads the always-on cron daemon (`launchctl bootstrap`), which starts on every login from now on.
3. Runs one test job in front of you.

## Step 3: read the result

At the end you will see the test job output. Look for one of these:
- `result: success` -> you are done. The nightly memory jobs are LIVE and self-maintaining. Nothing else to do, ever.
- `result: failure` with a 401 -> the token did not take. Re-run Step 1, make sure you copied the whole token with no spaces, and run Step 2 again.

## Step 4: let it run while you sleep (the nightly wake)

The jobs run in the background, but a sleeping Mac cannot run them. So macOS wakes the Mac once a night to run them, as long as it is plugged in. Run this one line in the Terminal (it asks for your password):

```
sudo pmset repeat wakeorpoweron MTWRFSU 23:35:00
```

That wakes the Mac every night at 11:35pm. It runs that night's jobs as one batch, then goes back to sleep. Keep the laptop plugged in (a Mac on battery refuses to wake itself). If it is closed or unplugged at 11:35pm, the jobs simply run the next time you open it, so nothing is lost.

That is it. After this, every night while plugged in:
- The day's notes get distilled into memory.
- The day's memory gets re-indexed for search.
- On Sunday, the weekly memory gap-check, clean-up, and a full rebuild also run, in the same nightly batch.

To check it is alive any time: `bash scripts/status-crons.sh` (you want to see `leader: true` and a recent heartbeat).

## If you ever move the AI-OS folder

The launchd file has absolute paths baked in. If you move the repo, re-run `bash scripts/enable-cron.sh` (it will reuse the stored token) after updating the paths in `~/Library/LaunchAgents/com.aios.cron-daemon.plist`.
