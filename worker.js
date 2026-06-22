// Xtream Codes VOD & LIVE – با ریدایرکت ۳۰۲ برای همه و احراز هویت
const GITHUB_BASE = "https://xc-vod-files.pages.dev";
const MOVIES_JSON = `${GITHUB_BASE}/movies.json`;
const SERIES_JSON = `${GITHUB_BASE}/series.json`;
const EPISODES_JSON = `${GITHUB_BASE}/episodes.json`;
const MOVIE_CATS_JSON = `${GITHUB_BASE}/movie_categories.json`;
const SERIES_CATS_JSON = `${GITHUB_BASE}/series_categories.json`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const VALID_USERNAME = "123";
const VALID_PASSWORD = "2580";

const log = (...a) => console.log(new Date().toISOString(), ...a);

function parseFilesize(username) {
  if (!username || typeof username !== 'string') return null;
  const match = username.match(/filesize:(\d+(?:\.\d+)?)/i);
  return match ? parseFloat(match[1]) : null;
}

function channelIdFromName(name) {
  const crc32 = (str) => {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++) {
      crc = crc ^ str.charCodeAt(i);
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ ((crc & 1) * 0xEDB88320);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const hash = crc32(name);
  return hash % 1000000000;
}

async function httpGet(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  return res;
}

async function fetchJSON(url) {
  try {
    const res = await httpGet(url);
    return await res.json();
  } catch (e) {
    log("[fetchJSON] error:", e.message);
    return [];
  }
}

function parseFileTable(html) {
  try {
    const files = [];
    const linkRegex = /<a\s+[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([^<]*)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1] || match[2] || match[3];
      const text = match[4];
      if (href === "../" || text.includes("Parent Directory") || href.endsWith("/")) continue;
      const remainingHtml = html.slice(match.index);
      const sizeMatch = remainingHtml.match(/data-sort\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (sizeMatch) {
        const sizeStr = sizeMatch[1] || sizeMatch[2] || sizeMatch[3];
        const size = parseInt(sizeStr, 10);
        if (size > 0) files.push({ url: href, size });
      }
    }
    return files;
  } catch (e) {
    log("[parseFileTable] error:", e.message);
    return [];
  }
}

function selectFile(files, targetSizeGB = null) {
  if (files.length === 0) return null;
  files.sort((a, b) => a.size - b.size);
  if (!targetSizeGB) return files[0].url;
  const targetSizeBytes = targetSizeGB * 1024 * 1024 * 1024;
  const belowOrEqual = files.filter(f => f.size <= targetSizeBytes);
  const above = files.filter(f => f.size > targetSizeBytes);
  if (belowOrEqual.length > 0) return belowOrEqual[belowOrEqual.length - 1].url;
  if (above.length > 0) return above[0].url;
  return files[0].url;
}

async function findSmallestFile(folderUrl, maxSizeGB = null) {
  try {
    const res = await httpGet(folderUrl);
    const html = await res.text();
    const files = parseFileTable(html);
    if (files.length === 0) return null;
    return selectFile(files, maxSizeGB);
  } catch (e) {
    return null;
  }
}

async function getEpisodeUrl(seriesItem, seasonNum, episodeNum, episodesData, maxSizeGB = null) {
  try {
    const episodeEntry = episodesData.find(
      ep => ep.tmdb_id === seriesItem.tmdb_id && ep.season === `Season ${String(seasonNum).padStart(2, '0')}`
    );
    if (!episodeEntry) return null;
    const episodeCode = `S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
    if (!episodeEntry.episodes.includes(episodeCode)) return null;
    const seasonUrl = `${seriesItem.folder_url}Season ${seasonNum}/`;
    const res = await httpGet(seasonUrl);
    const html = await res.text();
    const files = [];
    const linkRegex = /<a\s+[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([^<]*)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1] || match[2] || match[3];
      const fileName = match[4];
      if (href === "../" || fileName.includes("Parent Directory") || href.endsWith("/")) continue;
      if (fileName.includes(episodeCode)) {
        const remainingHtml = html.slice(match.index);
        const sizeMatch = remainingHtml.match(/data-sort\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        if (sizeMatch) {
          const sizeStr = sizeMatch[1] || sizeMatch[2] || sizeMatch[3];
          const size = parseInt(sizeStr, 10);
          if (size > 0) files.push({ url: href, size });
        }
      }
    }
    return selectFile(files, maxSizeGB);
  } catch (e) {
    return null;
  }
}

async function fetchAndParseLivePlaylist() {
  const playlistUrl = 'https://raw.githubusercontent.com/Behnood1368/Iptv/main/Kodi.m3u';
  try {
    const res = await httpGet(playlistUrl);
    let playlist = await res.text();
    const lines = playlist.split('\n');
    const parsedData = [];
    const categories = [];
    const categoryMap = {};
    let catCounter = 200;
    const usedIds = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) {
        const attrs = {};
        const attrMatches = line.matchAll(/([\w\-]+)\s*=\s*"([^"]*)"/g);
        for (const match of attrMatches) {
          attrs[match[1]] = match[2];
        }
        const nameMatch = line.match(/,(.*)$/);
        const channelName = nameMatch ? nameMatch[1].trim() : '';
        const epgId = attrs['tvg-id'] || channelName || 'unknown';
        const logo = attrs['tvg-logo'] || '';
        const group = (attrs['group-title'] || 'Uncategorized').trim();
        if (channelName) {
          if (!categoryMap[group]) {
            categoryMap[group] = catCounter++;
            categories.push({
              category_id: String(categoryMap[group]),
              category_name: group,
              parent_id: 0
            });
          }
          let streamId = channelIdFromName(channelName);
          while (usedIds.has(streamId)) {
            streamId = (streamId + 1) % 1000000000;
          }
          usedIds.add(streamId);
          let videoUrl = '';
          if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
            videoUrl = lines[i + 1].trim();
          }
          parsedData.push({
            num: streamId,
            name: channelName,
            stream_type: "live",
            stream_id: streamId,
            stream_icon: logo,
            epg_channel_id: epgId,
            added: Math.floor(Date.now() / 1000),
            category_id: categoryMap[group],
            custom_sid: "",
            tv_archive: 0,
            direct_source: videoUrl,
            tv_archive_duration: 0,
            video_url: videoUrl
          });
        }
      }
    }
    return { streams: parsedData, categories };
  } catch (e) {
    return { streams: [], categories: [] };
  }
}

// ---------- احراز هویت ----------
function checkAuth(username, password) {
  return username === VALID_USERNAME && password === VALID_PASSWORD;
}

// ---------- Route Handlers ----------
async function handleRoot() {
  return new Response(`Xtream API Ready`, { headers: { "Content-Type": "text/plain" } });
}

async function handlePlayerAPI(request) {
  const url = new URL(request.url);
  const action = (url.searchParams.get("action") || "").toLowerCase();
  const username = url.searchParams.get("username") || "";
  const password = url.searchParams.get("password") || "";

  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const baseUserInfo = {
    username,
    password,
    message: "Welcome to Xtream Server",
    auth: 1,
    status: "Active",
    exp_date: "2546304000",
    is_trial: "0",
    active_cons: "0",
    created_at: "1704067200",
    max_connections: "999",
    allowed_output_formats: ["m3u8", "ts", "mp4", "mkv"],
  };

  if (!action || action === "get_account_info") {
    return new Response(JSON.stringify({
      user_info: baseUserInfo,
      server_info: {
        url: url.hostname,
        port: "443",
        https_port: "443",
        server_protocol: "https",
        rtmp_port: "0",
        timezone: "UTC",
        timestamp_now: Math.floor(Date.now() / 1000),
      },
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_epg" || action === "get_short_epg") {
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_live_categories") {
    const { categories } = await fetchAndParseLivePlaylist();
    return new Response(JSON.stringify([{ category_id: "0", category_name: "All", parent_id: 0 }, ...categories]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_live_streams") {
    const requestedCat = Number(url.searchParams.get("category_id") ?? 0);
    const { streams } = await fetchAndParseLivePlaylist();
    let filtered = requestedCat !== 0 ? streams.filter(s => s.category_id === requestedCat) : streams;
    filtered = filtered.map(s => ({
      ...s,
      direct_source: `/live/${username}/${password}/${s.stream_id}`
    }));
    return new Response(JSON.stringify(filtered), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_vod_categories") {
    const cats = await fetchJSON(MOVIE_CATS_JSON);
    return new Response(JSON.stringify([{ category_id: 0, category_name: "All", parent_id: 0 }, ...cats.map(c => ({ ...c, parent_id: 0 }))]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_vod_streams") {
    const requestedCat = Number(url.searchParams.get("category_id") ?? 0);
    const movies = await fetchJSON(MOVIES_JSON);
    let filtered = requestedCat !== 0 ? movies.filter(m => m.category_id === requestedCat) : movies;
    const out = filtered.map((m, i) => ({
      num: i + 1,
      name: m.name,
      stream_type: "movie",
      stream_id: m.stream_id,
      stream_icon: m.stream_icon,
      rating: m.rating,
      added: Math.floor(Date.now() / 1000),
      category_id: m.category_id,
      container_extension: "mp4",
      custom_sid: null,
      direct_source: `/movie/${username}/${password}/${m.stream_id}`
    }));
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_vod_info") {
    const vodId = url.searchParams.get("vod_id");
    const movies = await fetchJSON(MOVIES_JSON);
    const movie = movies.find(m => String(m.stream_id) === String(vodId));
    if (!movie) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify({
      info: { movie_image: movie.stream_icon, plot: movie.plot || "", rating: movie.rating || 0 },
      movie_data: {
        stream_id: movie.stream_id,
        name: movie.name,
        category_id: movie.category_id,
        container_extension: "mp4",
        custom_sid: "",
        direct_source: `/movie/${username}/${password}/${movie.stream_id}`
      }
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_series_categories") {
    const cats = await fetchJSON(SERIES_CATS_JSON);
    return new Response(JSON.stringify([{ category_id: 0, category_name: "All", parent_id: 0 }, ...cats.map(c => ({ ...c, parent_id: 0 }))]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_series") {
    const requestedCat = Number(url.searchParams.get("category_id") ?? 0);
    const seriesList = await fetchJSON(SERIES_JSON);
    let filtered = requestedCat !== 0 ? seriesList.filter(s => s.category_id === requestedCat) : seriesList;
    const out = filtered.map((s, i) => ({
      num: i + 1,
      name: s.name,
      series_id: s.series_id,
      cover: s.stream_icon,
      plot: s.plot,
      last_modified: Math.floor(Date.now() / 1000),
      rating: s.rating,
      category_id: s.category_id,
    }));
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_series_info") {
    const seriesId = url.searchParams.get("series_id");
    const seriesList = await fetchJSON(SERIES_JSON);
    const series = seriesList.find(s => String(s.series_id) === String(seriesId));
    if (!series) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    const episodesData = await fetchJSON(EPISODES_JSON);
    const seriesEpisodes = episodesData.filter(ep => ep.tmdb_id === series.tmdb_id);
    const epsBySeason = {};
    for (const seasonData of seriesEpisodes) {
      const seasonMatch = seasonData.season.match(/Season (\d+)/);
      if (!seasonMatch) continue;
      const seasonNum = parseInt(seasonMatch[1], 10);
      if (!epsBySeason[seasonNum]) epsBySeason[seasonNum] = [];
      for (const episodeCode of seasonData.episodes) {
        const epMatch = episodeCode.match(/S(\d{2})E(\d{2})/);
        if (!epMatch) continue;
        const episodeNum = parseInt(epMatch[2], 10);
        const numericId = series.series_id * 10000 + seasonNum * 100 + episodeNum;
        const routingData = `${series.series_id}:${seasonNum}:${episodeNum}`;
        const containerExt = btoa(routingData);
        epsBySeason[seasonNum].push({
          id: numericId,
          episode_num: episodeNum,
          title: `Episode ${episodeNum}`,
          container_extension: "mp4",
          season: seasonNum,
          custom_sid: containerExt,
          direct_source: `/series/${username}/${password}/${numericId}`
        });
      }
    }
    return new Response(JSON.stringify({
      seasons: Object.keys(epsBySeason).map(s => ({ season_number: Number(s), name: `Season ${s}`, episode_count: epsBySeason[s].length })),
      info: { name: series.name, cover: series.stream_icon, plot: series.plot },
      episodes: epsBySeason
    }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "bad action" }), { status: 400 });
}

// ---------- مسیرهای استریم با ریدایرکت ۳۰۲ ----------
async function handleMovie(pathname, request) {
  const match = pathname.match(/\/movie\/([^/]+)\/([^/]+)\/(\d+)/);
  if (!match) return new Response("Bad URL", { status: 400 });
  const username = match[1];
  const password = match[2];
  const id = match[3];
  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const movies = await fetchJSON(MOVIES_JSON);
  const movie = movies.find(m => String(m.stream_id) === String(id));
  if (!movie) return new Response("Not found", { status: 404 });

  const maxSizeGB = parseFilesize(username);
  const fileUrl = await findSmallestFile(movie.folder_url, maxSizeGB);
  if (!fileUrl) return new Response("File not found", { status: 404 });

  log("[REDIRECT] movie →", fileUrl);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": fileUrl,
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function handleLiveStream(pathname, request) {
  const match = pathname.match(/\/live\/([^/]+)\/([^/]+)\/(\d+)/);
  if (!match) return new Response("Bad URL", { status: 400 });
  const username = match[1];
  const password = match[2];
  const streamId = Number(match[3]);
  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const { streams } = await fetchAndParseLivePlaylist();
  const stream = streams.find(s => s.stream_id === streamId);
  if (!stream || !stream.video_url) return new Response("Live stream not found", { status: 404 });

  log("[REDIRECT] live →", stream.video_url);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": stream.video_url,
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function handleSeries(pathname, request) {
  const match = pathname.match(/\/series\/([^/]+)\/([^/]+)\/(\d+)/);
  if (!match) return new Response("Bad URL", { status: 400 });
  const username = match[1];
  const password = match[2];
  const epIdNum = parseInt(match[3], 10);
  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const series_id = Math.floor(epIdNum / 10000);
  const remainder = epIdNum % 10000;
  const seasonNum = Math.floor(remainder / 100);
  const episodeNum = remainder % 100;

  const seriesList = await fetchJSON(SERIES_JSON);
  const series = seriesList.find(s => s.series_id === series_id);
  if (!series) return new Response("Series not found", { status: 404 });

  const episodesData = await fetchJSON(EPISODES_JSON);
  const fileUrl = await getEpisodeUrl(series, seasonNum, episodeNum, episodesData, parseFilesize(username));
  if (!fileUrl) return new Response("Episode file not found", { status: 404 });

  log("[REDIRECT] series →", fileUrl);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": fileUrl,
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/* ------------------ Main Worker ------------------ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
      let response;
      if (pathname === "/") {
        response = await handleRoot();
      } else if (pathname === "/player_api.php") {
        response = await handlePlayerAPI(request);
      } else if (pathname.startsWith("/movie/")) {
        response = await handleMovie(pathname, request);
      } else if (pathname.startsWith("/series/")) {
        response = await handleSeries(pathname, request);
      } else if (pathname.startsWith("/live/")) {
        response = await handleLiveStream(pathname, request);
      } else {
        response = new Response("Not Found", { status: 404 });
      }

      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  },
};
