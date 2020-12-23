# Install Instructions

First install chocolaty. You can go to https://chocolatey.org/install or follow instructions below.
1) run powershell as admin
2) run this command `Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))`

Restart windows powershell

Run the following commands in powershell to install stuff

`choco install nodejs-lts -y`
`choco install yarn -y`
`choco install git -y`
`choco install ffmpeg -y`

with this all installed go to a directory that you want to download the script folder ie the homedir: `cd ~`
run `git clone https://github.com/jeremypepper/twitch-jeremy-utils.git` to pull down the script
open the directory `cd twitch-jeremy-utils`
install script dependencies: `yarn install`


# set the twitch secret environment variable (ask jeremy for this)
`$Env:TWITCH_SECRET=secret_key_here`

# Run the script:

This will fetch the top 10 clips in the last 24h for channel xanagear:
`node index.js xanagear -s 24h -n 10`
