const axios = require('axios');
const process = require('process');
const mkdirp = require('mkdirp')
const {spawn} = require('child_process');
const {onExit} = require('@rauschma/stringio');
const {DateTime} = require("luxon");
const _ = require('lodash')
const fs = require('fs');
const retry = require('retry');

const now = DateTime.local();

const clientId = "l8mt5v8ivse0rwy6gg8ykknhs1oszc";
const clientSecret = process.env["TWITCH_SECRET"];
if (!clientSecret) {
  console.error("need to set the twitch secret env var TWITCH_SECRET")
  process.exit(1);
}

const retryOperation = retry.operation({
  retries: 3,
  minTimeout: 30 * 1000,
});

async function getToken() {
  const url = `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}`
      + `&grant_type=client_credentials`
  console.log("fetching", url)
  return await axios.post(url
    ).then(function (response) {
      const token = response.data.access_token;
      return token;
    })
      .catch(e => {
        console.error(e)
      })
}

async function getUserId(token, name) {
  const url = `https://api.twitch.tv/helix/search/channels?first=1&query=` + encodeURIComponent(name);
  console.log("fetching", url)
  return await axios.get(url, {
    headers: {
      'client-id': clientId,
      Authorization: `Bearer ${token}`
    }
  }).then(response => {
    return response.data.data[0].id
  }).catch(e=> {
    console.error("could not fetch id", e);
    process.exit(1);
  })
}

async function getClips(token, clipOptions, userId) {
  const after = clipOptions.nHoursAgoStart.toISO()
  const before = clipOptions.nHoursAgoEnd.toISO();
  const url = `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&started_at=${after}&ended_at=${before}&first=${clipOptions.clipsToFetch}`;
  console.log("fetching", url)
  return await axios.get(url, {
    headers: {
      'client-id': clientId,
      Authorization: `Bearer ${token}`
    }
  }).then(response => {
    console.log("got clips from twitch")
    console.log(_.map(response.data.data, clip => clip.title + " " + clip.url))
    return response.data.data;
  })
}

async function downloadClips(clipsData, clipOptions) {
  const playlistLines = ["#EXTM3U"];
  const clipPaths = [];
  for (let i = 0; i < clipsData.length; i++) {
    const clipData = clipsData[i];
    const clipUrl = clipData.url;
    const url = 'https://clipr.xyz/api/grabclip';
    const clipName = _.truncate(
        clipData.title.replace(/\W+/g, "-"),
        {length: 50, omission: ""})
        + "_" + clipData["video_id"];
    const downloadUrl = await axios.post(url, {
      clip_url: clipUrl
    }).then(response=> {
      return 'https:' + response.data["download_url"];
    });
    retryOperation.attempt(async (currentAttempt) =>{
      console.log("downloading", downloadUrl, "attempt", currentAttempt)
      try {
        await axios.get(downloadUrl, {
          responseType: 'stream'
        }).then(response => {
          const clipPath = `${clipOptions.dir}/${clipName}.mp4`;
          response.data.pipe(fs.createWriteStream(clipPath))
          playlistLines.push(`#EXTINF:5,${clipName}.mp4`)
          playlistLines.push(`${clipName}.mp4`);
          clipPaths.push(clipPath);
          console.log("file downloaded to", clipPath)
        })
      } catch (e) {
        console.warn(e);
        if (retryOperation.retry(e)) { return; }
      }
    })
  }
  // for some reason the last file doesn't get download so delay for a bit to see if that helps
  await sleep(2500)
  fs.writeFileSync(clipOptions.playlistFile, playlistLines.join("\n"))
  console.log("wrote playlist to", clipOptions.playlistFile)
  return clipPaths;
}

async function merge(clipPaths, clipOptions) {
  console.log("merging with ffmpeg")
  const inputs = [];
  const filterComplex = [];
  for (let i = 0; i < clipPaths.length; i++) {
    inputs.push(`-i ${clipPaths[i]}`)
    filterComplex.push(`[${i}:v] [${i}:a]`)
  }

  const inputArgs = inputs.join(" ");
  const filterComplexArgs = filterComplex.join(" ")
  const cmdArgs = [
      ...inputArgs.split(" "),
      "-filter_complex",
      `${filterComplexArgs}\n concat=n=${clipPaths.length}:v=1:a=1 [v] [a]`,
        '-map', '[v]',
        '-map', '[a]',
        '-y',
        `${clipOptions.highlightsPath}`
  ]
  console.log("calling ffmpeg", cmdArgs)

  try {
    const childProcess = spawn("ffmpeg", cmdArgs,
        {stdio: [process.stdin, process.stdout, process.stderr]}); // (A)
    await onExit(childProcess); // (B
  } catch (e) {console.log("error running ffmpeg", e)
  }
}

// for debugging pauses
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseArgs() {
  const parsedArgs = require('yargs/yargs')(process.argv.slice(2))
      .command('$0 channelName','download clips from a channel and merge into a highlight video',
        yargs => {
          yargs
          .option('s', {
            describe: 'Start Hours Ago',
            default: 6,
            type: 'number',
          })
          .option('e', {
            describe: 'End Hours Ago',
            default: 0,
            type: 'number',
          })
          .option('n', {
            describe: 'Number of clips to fetch',
            default: 10,
            type: 'number',
          })
          .positional('channelName', {
            describe: 'Name of the channel to fetch',
            type: 'string',
          })
        }
      ).argv;
  const nHoursAgoStart = now.plus({hours: -parsedArgs.s})
  const dir = `downloads/${nHoursAgoStart.toISODate()}`;
  const clipOptions = {
    nHoursAgoStart,
    nHoursAgoEnd: now.plus({hours: -parsedArgs.e}),
    clipsToFetch: parsedArgs.n,
    dir,
    playlistFile: `${dir}/playlist.m3u`,
    highlightsPath: `${dir}/_highlights_${now.valueOf()}.mp4`,
    name: parsedArgs.channelName,
  }
  return clipOptions;
}

async function go() {
  const clipOptions = parseArgs();

  await mkdirp(clipOptions.dir)
  const token = await getToken()
  const userId = await getUserId(token, clipOptions.name)
  const clipsData = await getClips(token, clipOptions, userId)
  const clipPaths = await downloadClips(clipsData, clipOptions);
  await merge(clipPaths, clipOptions)
  console.log("Reencode complete.")
  console.log(clipOptions.highlightsPath)
  console.log("Download clips playlist")
  console.log(clipOptions.playlistFile)
}

go();
