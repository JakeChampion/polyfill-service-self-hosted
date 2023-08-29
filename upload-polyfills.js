#!/usr/bin/env node

import { $ as zx} from 'zx'
import { exit, env } from 'node:process'

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';


async function retry(function_) {
    let again = true;
    let maxAttempts = 10;
    let counter = 0;
    do {
        try {
            await function_()
            again = false
        } catch (error) {
            if (counter < maxAttempts) {
                again = true;
                counter += 1;
            } else {
                throw error;
            }
        }
    }
    while (again)
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getFastlyApiKey() {
    let v = zx.verbose;
    zx.verbose = false;
    if (env.FASTLY_API_TOKEN === undefined) {
        try {
            env.FASTLY_API_TOKEN = String(await zx`fastly profile token --quiet`).trim()
        } catch {
            console.error('No environment variable named FASTLY_API_TOKEN has been set and no default fastly profile exists.');
            console.error('In order to run this script, either create a fastly profile using `fastly profile create` or export a fastly token under the name FASTLY_API_TOKEN');
            exit(1)
        }
    }
    zx.verbose = v;
}

async function getOrCreatePolyfillKVStore() {
    let stores = await (async function() {
        try {
            let response = await fetch("https://api.fastly.com/resources/stores/kv", {
                method: 'GET',
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "Fastly-Key": env.FASTLY_API_TOKEN
                }
            });
            return await response.json();
        } catch {
            return {data:[]}
        }
    }())

    env.STORE_ID = stores.data.find(({ name }) => name === 'polyfill-library')?.id
    if (!env.STORE_ID) {
        env.STORE_ID = await fetch("https://api.fastly.com/resources/stores/kv", {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "Fastly-Key": env.FASTLY_API_TOKEN
            },
            body: '{"name":"polyfill-library"}'
        })
        env.STORE_ID = (await env.STORE_ID.json()).id
    }
}

async function linkKVStoreToServiceAndActivate() {
    env.VERSION = String(await zx`fastly service-version clone --quiet --version=latest --token $FASTLY_API_TOKEN`).trim()
    env.VERSION = env.VERSION.match(/\d+$/)?.[0]

    let SERVICE_ID = await zx`fastly service describe --json --quiet --token $FASTLY_API_TOKEN`
    SERVICE_ID = JSON.parse(SERVICE_ID).ID
    await fetch(`https://api.fastly.com/service/${SERVICE_ID}/version/${env.VERSION}/resource`, {
        method: 'POST',
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "Fastly-Key": env.FASTLY_API_TOKEN
        },
        body: `name=example-test-kv-store&resource_id=${env.STORE_ID}`
    })
    await zx`fastly service-version activate --version=$VERSION --quiet --token $FASTLY_API_TOKEN`
}

async function uploadPolyfillsToKVStore() {
    let polyfillsDirectory = join(__dirname, 'app/polyfill-libraries/polyfill-library/polyfills/__dist/');
    const files = await readdir(polyfillsDirectory, { withFileTypes: true});
    for (const file of files) {
        await retry(async function() {
            let url = `https://api.fastly.com/resources/stores/kv/${env.STORE_ID}/keys/${encodeURIComponent(file.name)}`
            const resp = await fetch(url, {
                method: 'PUT',
                headers: {
                    "Fastly-Key": env.FASTLY_API_TOKEN
                },
                body: readFile(join(file.path, file.name), "utf8")
            })
            if (resp.status != 200) {
                console.log(resp.status)
                throw new Error(`Failed to upload: ${url}`)
            }
            console.log(`Uploaded: ${file.name}`)
        })
    }
}

await getFastlyApiKey()
await getOrCreatePolyfillKVStore()
await linkKVStoreToServiceAndActivate()
await uploadPolyfillsToKVStore()
