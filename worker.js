// Xtream Codes VOD & LIVE – با ریدایرکت ۳۰۲ و احراز هویت (آدرس لایو جدید)
const GITHUB_BASE = "https://xc-vod-files.pages.dev";
const MOVIES_JSON = `${GITHUB_BASE}/movies.json`;
const SERIES_JSON = `${GITHUB_BASE}/series.json`;
const EPISODES_JSON = `${GITHUB_BASE}/episodes.json`;
const MOVIE_CATS_JSON = `${GITHUB_BASE}/movie_categories.json`;
const SERIES_CATS_JSON = `${GITHUB_BASE}/series_categories.json`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// اعتبارنامه‌های مجاز
const VALID_USERNAME = "123";
const VALID_PASSWORD = "2580";

/* ------------------ helpers ------------------ */
const log = (...a) => console.log(new Date().toISOString(), ...a);

function escapeAttr(s) {
  return String(s).replace(/"/g, '\\"');
}

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

// تابع دریافت لیست پخش زنده با آدرس جدید
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
        const epgId = attrs['tvg-id'] || '';
        const logo = attrs['tvg-logo'] || '';
        const group = (attrs['group-title'] || 'Uncategorized').trim();
        if (channelName && epgId && group) {
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
    log("[fetchAndParseLivePlaylist] error:", e.message);
    return { streams: [], categories: [] };
  }
}

// ---------- احراز هویت ----------
function checkAuth(username, password) {
  return username === VALID_USERNAME && password === VALID_PASSWORD;
}

/* ------------------ Route Handlers ------------------ */

async function handleRoot() {
  return new Response(`Xtream API Ready`, { headers: { "Content-Type": "text/plain" } });
}

async function handleM3U(request) {
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "").toLowerCase();
  if (type !== "m3u_plus") {
    return new Response("Only type=m3u_plus supported", { status: 400 });
  }

  const base = `${url.protocol}//${url.host}`;
  const movies = await fetchJSON(MOVIES_JSON);
  const categories = await fetchJSON(MOVIE_CATS_JSON);

  const sortedCategories = categories.sort((a, b) => 
    (a.category_name || "").localeCompare(b.category_name || "")
  );

  const categoryMap = new Map();
  for (const cat of sortedCategories) {
    categoryMap.set(cat.category_id, cat.category_name);
  }

  const lines = ["#EXTM3U"];

  for (const m of movies) {
    const movieUrl = `${base}/movie/x/x/${m.stream_id}`;
    const groupTitle = categoryMap.get(m.category_id) || "Uncategorized";
    
    lines.push(
      `#EXTINF:-1 tvg-id="${m.tmdb_id}" tvg-name="${escapeAttr(m.name)}" tvg-logo="${m.stream_icon}" group-title="${escapeAttr(groupTitle)}",${m.name}`
    );
    lines.push(movieUrl);
  }

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "application/x-mpegURL" }
  });
}

async function handlePlayerAPI(request) {
  const url = new URL(request.url);
  const action = (url.searchParams.get("action") || "").toLowerCase();
  const username = url.searchParams.get("username") || "";
  const password = url.searchParams.get("password") || "";

  // احراز هویت اجباری
  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!action) {
    const hostname = url.hostname;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const proto = url.protocol.replace(":", "");

    return new Response(JSON.stringify({
      user_info: {
        username,
        password,
        message: "Welcome to Xtream VOD",
        auth: 1,
        status: "Active",
        exp_date: "2546304000",
        is_trial: "0",
        active_cons: "1",
        created_at: "1704067200",
        max_connections: "999",
        allowed_output_formats: ["m3u8", "ts", "mp4", "mkv"],
      },
      server_info: {
        url: hostname,
        port,
        https_port: proto === "https" ? port : "443",
        server_protocol: proto,
        rtmp_port: "0",
        timezone: "UTC",
        timestamp_now: Math.floor(Date.now() / 1000),
        time_now: new Date().toISOString().replace("T", " ").slice(0, 19),
      },
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_account_info") {
    const hostname = url.hostname;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const proto = url.protocol.replace(":", "");

    return new Response(JSON.stringify({
      user_info: {
        username,
        password,
        message: "Welcome to Xtream Mock",
        auth: 1,
        status: "Active",
        exp_date: "2546304000",
        is_trial: "0",
        active_cons: "1",
        created_at: "1704067200",
        max_connections: "999",
        allowed_output_formats: ["m3u8", "ts", "mp4", "mkv"],
      },
      server_info: {
        url: hostname,
        port,
        https_port: proto === "https" ? port : "443",
        server_protocol: proto,
        rtmp_port: "0",
        timezone: "UTC",
        timestamp_now: Math.floor(Date.now() / 1000),
        time_now: new Date().toISOString().replace("T", " ").slice(0, 19),
      },
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_epg" || action === "get_short_epg") {
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_live_categories") {
    const { categories } = await fetchAndParseLivePlaylist();
    return new Response(JSON.stringify([
      { category_id: "0", category_name: "All", parent_id: 0 },
      ...categories
    ]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_live_streams") {
    const requestedCat = Number(url.searchParams.get("category_id") ?? 0);
    const { streams } = await fetchAndParseLivePlaylist();
    let filtered = streams;
    if (requestedCat !== 0) {
      filtered = streams.filter(s => s.category_id === requestedCat);
    }
    // اضافه کردن direct_source با مسیر ریدایرکت
    filtered = filtered.map(s => ({
      ...s,
      direct_source: `/live/${username}/${password}/${s.stream_id}`
    }));
    return new Response(JSON.stringify(filtered), { 
      headers: { "Content-Type": "application/json" } 
    });
  }

  if (action === "get_vod_categories") {
    const cats = await fetchJSON(MOVIE_CATS_JSON);
    const sorted = cats.sort((a, b) => 
      (a.category_name || "").localeCompare(b.category_name || "")
    );
    return new Response(JSON.stringify([
      { category_id: 0, category_name: "All", parent_id: 0 },
      ...sorted.map((c) => ({ ...c, parent_id: 0 })),
    ]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_vod_streams") {
    const requestedCat = Number(url.searchParams.get("category_id") ?? 0);
    const movies = await fetchJSON(MOVIES_JSON);
    let filtered = movies;
    if (requestedCat !== 0) {
      filtered = movies.filter((m) => m.category_id === requestedCat);
    }
    filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const out = filtered.map((m, i) => ({
      num: i + 1,
      name: m.name,
      stream_type: "movie",
      stream_id: m.stream_id,
      stream_icon: m.stream_icon,
      rating: m.rating,
      rating_5based: m.rating_5based,
      added: Math.floor(Date.now() / 1000),
      category_id: m.category_id,
      container_extension: "mp4",
      custom_sid: null,
      direct_source: `/movie/${username}/${password}/${m.stream_id}`,
      plot: m.plot,
      backdrop_path: m.backdrop_path || [],
    }));

    return new Response(JSON.stringify(out), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (action === "get_vod_info") {
    const vodId = url.searchParams.get("vod_id");
    if (!vodId) {
      return new Response(JSON.stringify({ error: "missing vod_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const movies = await fetchJSON(MOVIES_JSON);
    const movie = movies.find((m) => String(m.stream_id) === String(vodId));
    if (!movie) {
      return new Response(JSON.stringify({ error: "vod not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      info: {
        movie_image: movie.stream_icon,
        tmdb_id: movie.tmdb_id || "",
        youtube_trailer: movie.yt_trailer || "",
        genre: movie.genre || "",
        director: "",
        plot: movie.plot || "",
        cast: "",
        rating: movie.rating || 0,
        video: [],
        audio: [],
        bitrate: 0,
        backdrop_path: movie.backdrop_path || [],
      },
      movie_data: {
        stream_id: movie.stream_id,
        name: movie.name,
        added: Math.floor(Date.now() / 1000),
        category_id: movie.category_id,
        container_extension: "mp4",
        custom_sid: null,
        direct_source: `/movie/${username}/${password}/${movie.stream_id}`,
      },
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_series_categories") {
    const cats = await fetchJSON(SERIES_CATS_JSON);
    const sorted = cats.sort((a, b) => 
      (a.category_name || "").localeCompare(b.category_name || "")
    );
    return new Response(JSON.stringify([
      { category_id: 0, category_name: "All", parent_id: 0 },
      ...sorted.map((c) => ({ ...c, parent_id: 0 })),
    ]), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "get_series") {
    const requestedCat = Number(url.searchParams.get("category_id") ?? 0);
    const seriesList = await fetchJSON(SERIES_JSON);
    let filtered = seriesList;
    if (requestedCat !== 0) {
      filtered = seriesList.filter((s) => s.category_id === requestedCat);
    }
    filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const out = filtered.map((s, i) => ({
      num: i + 1,
      name: s.name,
      series_id: s.series_id,
      cover: s.stream_icon,
      plot: s.plot,
      cast: "",
      director: "",
      genre: "",
      releaseDate: "",
      last_modified: Math.floor(Date.now() / 1000),
      rating: s.rating,
      rating_5based: s.rating_5based,
      backdrop_path: s.backdrop_path || [],
      youtube_trailer: s.yt_trailer || "",
      episode_run_time: 0,
      category_id: s.category_id,
    }));

    return new Response(JSON.stringify(out), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (action === "get_series_info") {
    const seriesId = url.searchParams.get("series_id");
    if (!seriesId) {
      return new Response(JSON.stringify({ error: "missing series_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const seriesList = await fetchJSON(SERIES_JSON);
    const series = seriesList.find((s) => String(s.series_id) === String(seriesId));
    if (!series) {
      return new Response(JSON.stringify({ error: "series not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

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
          container_extension: containerExt,
          custom_sid: "",
          added: "",
          season: seasonNum,
          direct_source: `/series/${username}/${password}/${numericId}.${containerExt}`,
          info: {
            tmdb_id: series.tmdb_id || "",
            name: `Episode ${episodeNum}`,
            cover_big: series.backdrop_path || "",
            plot: "",
            movie_image: series.backdrop_path || "",
          },
        });
      }
    }

    return new Response(JSON.stringify({
      seasons: Object.keys(epsBySeason).map((s) => ({
        air_date: "",
        episode_count: epsBySeason[s].length,
        id: series.series_id,
        name: `Season ${s}`,
        overview: "",
        season_number: Number(s),
        backdrop_path: series.backdrop_path || "",
        cover: series.stream_icon,
        cover_big: series.backdrop_path || "",
      })),
      info: {
        name: series.name,
        cover: series.stream_icon,
        plot: series.plot,
        cast: "",
        director: "",
        genre: "",
        releaseDate: "",
        last_modified: Math.floor(Date.now() / 1000),
        rating: series.rating,
        rating_5based: series.rating_5based,
        backdrop_path: series.backdrop_path || [],
        youtube_trailer: series.yt_trailer || "",
        episode_run_time: 0,
        category_id: series.category_id,
      },
      episodes: epsBySeason,
    }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "unsupported action" }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });
}

// ---------- مسیرهای استریم با ریدایرکت ۳۰۲ ----------
async function handleMovie(pathname, request) {
  const match = pathname.match(/\/movie\/([^/]+)\/([^/]+)\/(\d+)(?:\.[^/]+)?$/);
  if (!match) return new Response("Invalid movie URL", { status: 400 });

  const username = match[1];
  const password = match[2];
  const id = match[3];

  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const movies = await fetchJSON(MOVIES_JSON);
  const movie = movies.find((m) => String(m.stream_id) === String(id));
  if (!movie) return new Response("movie not found", { status: 404 });

  const maxSizeGB = parseFilesize(username);
  const fileUrl = await findSmallestFile(movie.folder_url, maxSizeGB);
  if (!fileUrl) return new Response("no video file found", { status: 404 });

  log("[REDIRECT] movie →", fileUrl);
  return Response.redirect(fileUrl, 302);
}

async function handleLiveStream(pathname, request) {
  const match = pathname.match(/\/live\/([^/]+)\/([^/]+)\/(\d+)/);
  if (!match) return new Response("Bad URL", { status: 400 });

  const username = match[1];
  const password = match[2];
  const streamId = Number(match[3]);

  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { streams } = await fetchAndParseLivePlaylist();
  const stream = streams.find(s => s.stream_id === streamId);
  if (!stream || !stream.video_url) return new Response("Live stream not found", { status: 404 });

  log("[REDIRECT] live →", stream.video_url);
  return Response.redirect(stream.video_url, 302);
}

async function handleSeries(pathname, request) {
  const match = pathname.match(/\/series\/([^/]+)\/([^/]+)\/(\d+)\.([^/]+)$/);
  if (!match) return new Response("Invalid series URL", { status: 400 });

  const username = match[1];
  const password = match[2];
  const episodeId = match[3];
  const ext = match[4];

  if (!checkAuth(username, password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const routingData = atob(ext);
    const [series_id, seasonNum, episodeNum] = routingData.split(':').map(Number);
    if (!series_id || !seasonNum || !episodeNum) {
      return new Response("invalid episode format", { status: 400 });
    }

    const maxSizeGB = parseFilesize(username);
    const seriesList = await fetchJSON(SERIES_JSON);
    const series = seriesList.find((s) => s.series_id === series_id);
    if (!series) return new Response("series not found", { status: 404 });

    const episodesData = await fetchJSON(EPISODES_JSON);
    const fileUrl = await getEpisodeUrl(series, seasonNum, episodeNum, episodesData, maxSizeGB);
    if (!fileUrl) return new Response("episode not found", { status: 404 });

    log("[REDIRECT] series →", fileUrl);
    return Response.redirect(fileUrl, 302);
  } catch (e) {
    return new Response("invalid episode encoding", { status: 400 });
  }
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
      } else if (pathname === "/get.php") {
        response = await handleM3U(request);
      } else if (pathname === "/player_api.php") {
        response = await handlePlayerAPI(request);
      } else if (pathname === "/xmltv.php") {
        return Response.redirect("http://drewlive24.duckdns.org:8081/DrewLive/DrewLive.xml.gz", 302);
      } else if (pathname.startsWith("/movie/")) {
        response = await handleMovie(pathname, request);
      } else if (pathname.startsWith("/live/")) {
        response = await handleLiveStream(pathname, request);
      } else if (pathname.startsWith("/series/")) {
        response = await handleSeries(pathname, request);
      } else {
        response = new Response("Not Found", { status: 404 });
      }

      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

    } catch (e) {
      log("[ERROR]", e.message, e.stack);
      return new Response(JSON.stringify({ error: "internal server error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
