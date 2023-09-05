// @ts-check
/// <reference types="@fastly/js-compute" />

import { env } from 'fastly:env';
import { SimpleCache } from 'fastly:cache';
import { ConfigStore } from 'fastly:config-store';

import { getPolyfillParameters } from "./get-polyfill-parameters.js";
import * as polyfillio from "./polyfill-libraries/polyfill-library/lib/index.js";
import { retry } from './retry.js';
import { normalise_querystring_parameters_for_polyfill_bundle } from "./normalise-query-parameters.js";

export async function polyfillHandler(c) {
	let requestURL = new URL(c.req.url);
	c.header('FASTLY_SERVICE_VERSION', env('FASTLY_SERVICE_VERSION'));

	requestURL.search = normalise_querystring_parameters_for_polyfill_bundle(
		c.req,
		requestURL.searchParams
	).toString();

	let response = await polyfill(requestURL, c);

	response.headers.set('useragent_normaliser', requestURL.searchParams.get('ua'));

	let vary = response.headers.get("vary");
	if (vary) {
		if (!/\bUser-Agent\b/.test(vary)) {
			response.headers.set("vary", `${vary}, User-Agent`);
		}
	} else {
		response.headers.set("vary", "User-Agent");
	}

	if (vary) {
		if (!/\bAccept-Encoding\b/.test(vary)) {
			response.headers.set("vary", `${vary}, Accept-Encoding`);
		}
	} else {
		response.headers.set("vary", "Accept-Encoding");
	}

	if (c.req.headers.has("if-modified-since") && response.headers.get("last-modified") && new Date(c.req.headers.get("if-modified-since")) >= new Date(response.headers.get("last-modified"))) {
		response.headers.set("age", "0");
		response = new Response(undefined, {
			status: 304,
			headers: response.headers
		});
	}

	if (response.status == 304 || response.status == 200) {
		response.headers.set("Age", "0");
	}

	return response;
}

function respondWithBundle(c, bundle) {
	c.status(200);
	c.header("Access-Control-Allow-Origin", "*");
	c.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
	c.header("Cache-Control", "public, s-maxage=31536000, max-age=604800, stale-while-revalidate=604800, stale-if-error=604800, immutable");
	c.header("Content-Type", "text/javascript; charset=UTF-8");
	c.header("x-compress-hint", "on");

	return c.body(bundle);
}

// TODO: Implement ReadableStream getIterator() and [@@asyncIterator]() methods
// eslint-disable-next-line no-unused-vars
const decoder = new TextDecoder();
async function streamToString(stream) {
	let string = '';
	let reader = stream.getReader()
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			return string;
		}
		string += decoder.decode(value)
	}
}

async function polyfill(requestURL, c) {
	if (env("FASTLY_HOSTNAME") !== "localhost") {
		let config = new ConfigStore('polyfill_config');
		const generation = config.get('generation') || '1';
		let cacheKey = `${generation}:::${requestURL.pathname + requestURL.search}}`;
		let error = false;
		let value = await retry(async () => SimpleCache.getOrSet(cacheKey, async () => {
			const parameters = getPolyfillParameters(requestURL);
			let bundle = await polyfillio.getPolyfillString(parameters);
			return {
				value: await streamToString(bundle),
				ttl: 604800,
			}
		}));
		if (error) {
			c.status(400);
			c.header("Access-Control-Allow-Origin", "*");
			c.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
			c.header("Cache-Control", "public, s-maxage=31536000, max-age=604800, stale-while-revalidate=604800, stale-if-error=604800, immutable");
			c.header("Content-Type", "text/javascript; charset=UTF-8");
			c.header("surrogate-key", "polyfill-service");
			c.header("x-compress-hint", "on");
			return c.body(value.body)
		}
		return respondWithBundle(c, value.body);
	}
	const parameters = getPolyfillParameters(requestURL);

	let bundle = await polyfillio.getPolyfillString(parameters);
	return respondWithBundle(c, bundle);
}
