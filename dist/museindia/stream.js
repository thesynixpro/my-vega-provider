// @vega-provider museindia
// @vega-version 1.0.0
"use strict";

var CHANNEL_NAME = "Muse India";
var CHANNEL_URL = "https://www.youtube.com/@MuseIndiaChannel";
exports.getStream = async function(args) { var link = String(args.link || ""); var m = link.match(/[?&]v=([A-Za-z0-9_-]{6,})|youtu\.be\/([A-Za-z0-9_-]{6,})/); var id = m ? (m[1] || m[2]) : ""; return [{ server: CHANNEL_NAME + " – YouTube", link: id ? "https://www.youtube.com/watch?v=" + id : CHANNEL_URL, type: "webview", tag: id ? "Official YouTube player" : "Open official channel" }]; };
