// @ts-check
import { app } from "./app.js";

globalThis.addEventListener("fetch", (event) => {
    try {
        event.respondWith(app.handleEvent(event));
    } catch (error) {
        console.error("error:", error)
        event.respondWith(new Response("Internal Server Error " + error.message || error, { status: 500 }))
    }
});