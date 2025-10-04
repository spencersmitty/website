#!/bin/bash
cd "$(dirname "$0")"

python3 -m http.server 8000 &
SERVER_PID=$!

# cleanup when script/terminal exits
trap "kill $SERVER_PID" EXIT

sleep 2
open "http://localhost:8000"
open "http://localhost:8000/gallery.html"

# keep terminal open
wait $SERVER_PID