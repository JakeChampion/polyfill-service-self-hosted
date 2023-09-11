// @ts-check
import { env } from 'fastly:env';
import {ConfigStore} from 'fastly:config-store';
var humanize = (times) => {
	const [delimiter, separator] = [",", "."];
	const orderTimes = times.map((v) => v.replaceAll(/(\d)(?=(\d{3})+(?!\d))/g, "$1" + delimiter));
	return orderTimes.join(separator);
};
var time = (start) => {
	const delta = Date.now() - start;
	return humanize([delta < 1e3 ? delta + "ms" : Math.round(delta / 1e3) + "s"]);
};
var colorStatus = (status) => {
	const out = {
		7: `\u001B[35m${status}\u001B[0m`,
		5: `\u001B[31m${status}\u001B[0m`,
		4: `\u001B[33m${status}\u001B[0m`,
		3: `\u001B[36m${status}\u001B[0m`,
		2: `\u001B[32m${status}\u001B[0m`,
		1: `\u001B[32m${status}\u001B[0m`,
		0: `\u001B[33m${status}\u001B[0m`
	};
	const calculateStatus = Math.trunc(status / 100);
	return out[calculateStatus];
};

function log(function_, prefix, method, url, status = 0, elapsed) {
	const out = prefix.startsWith("<--") /* Incoming */ ? `  ${prefix} ${method} ${url}` : `  ${prefix} ${method} ${url} ${colorStatus(status)} ${elapsed}`;
	function_(out);
}
var logger = (function_ = console.log) => {
	return async (c, next) => {
		const {
			method
		} = c.req;
		const url = c.req.url;
		let start = Date.now();
		if (shouldLog()) {
			log(function_, `<-- (Incoming) FASTLY_SERVICE_VERSION: ${env('FASTLY_SERVICE_VERSION')}` /* Incoming */ , method, url);
			await next();
		} else {
			await next();
		}
		let end = (Date.now()-start)/1000
		if (end > 10 || shouldLog() || c.error) {
			log(function_, `--> (Outgoing) FASTLY_SERVICE_VERSION: ${env('FASTLY_SERVICE_VERSION')}` /* Outgoing */ , method, url, c.res.status, time(start));
		}
	};
};

// Persist within a request in order to have same logging sample within a request
var cachedRandomPercentage;

function getRandomPercentage(){
	if (typeof cachedRandomPercentage === 'undefined') {
		cachedRandomPercentage = Math.random() * 100;
	}

	return cachedRandomPercentage;
}
function withinSampleRate(randomPercentage) {
	const config = new ConfigStore('polyfill_config');
	const sampleRateString = config.get('sample_rate');

	if (!sampleRateString) return true; // no sampling

	const sampleRate = parseInt(sampleRateString, 10); // Sample rate in integer %

	return randomPercentage < sampleRate;
}

function shouldLog() {
	const randomPercentage = getRandomPercentage();

	const config = new ConfigStore('polyfill_config');
	return config.get('log') === '1' && withinSampleRate(randomPercentage);
}
export {
	shouldLog,
	logger
};
