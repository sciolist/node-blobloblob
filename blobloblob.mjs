import { PassThrough, Stream, Readable } from 'stream';
import mimeTypes from 'mime-types';
import BusBoy from 'busboy';
import fs from 'fs';
import path from 'path';
import os from 'os';

function isStreamable(value) {
    return value && typeof value.stream === 'function';
}
function promisifyEvent(node, evt) {
    return new Promise((resolve, reject) => {
        node.on('error', reject);
        node.on(evt, (...args) => resolve(args));
    });
}
function randomString() {
    return [0, 0, 0]
        .map(() => Math.random()
        .toString(36)
        .substring(2))
        .join('');
}
async function streamToBuffer(stream) {
    return await new Promise((resolve, reject) => {
        const result = [];
        stream.on('data', (d) => {
            result.push(d);
        });
        stream.on('end', () => {
            resolve(Buffer.concat(result));
        });
        stream.on('error', reject);
    });
}

const BlobClass = class Blob {
    constructor(parts, properties) {
        this[Symbol.toStringTag] = 'Blob';
        this.size = (properties && properties.size) || 0;
        this.type = properties && properties.type;
        this.stream = () => concatenateToStream(parts || []);
    }
    slice(start, end, contentType) {
        throw new Error('slice not implemented');
    }
};
const FileClass = class File extends BlobClass {
    constructor(parts, name, properties) {
        super(parts, {
            type: mimeTypes.lookup(String(name)) || '',
            ...properties
        });
        this[Symbol.toStringTag] = 'File';
        this.lastModified = (properties && properties.lastModified) || 0;
        this.name = name;
    }
};
function concatenateToStream(parts) {
    let result = new PassThrough();
    if (parts.length) {
        sendNextPart(result, parts);
    }
    else {
        result.end();
    }
    return result;
}
function sendNextPart(target, [head, ...rest]) {
    const stream = convertToStream(head);
    stream.pipe(target, { end: !rest.length });
    if (rest.length) {
        stream.once('end', () => sendNextPart(target, rest));
    }
}
function convertToStream(part) {
    if (isStreamable(part)) {
        return part.stream();
    }
    else if (typeof part === 'function') {
        return part();
    }
    else if (part instanceof Stream) {
        return part;
    }
    return new Readable({
        read(size) {
            this.push(part);
            this.push(null);
        }
    });
}
function isBlob(value) {
    return value && typeof value.type === 'string' && /^File|Blob$/.test(value[Symbol.toStringTag]);
}
var File = FileClass;
var Blob = BlobClass;

class FormData {
    constructor() {
        this.entries = new Array();
        this.stream = () => createFormDataBody(this.boundary, this.entries);
        this.boundary = `FormBoundary${randomString()}`;
    }
    get headers() {
        return {
            'Content-Type': `multipart/form-data; boundary=${this.boundary}`
        };
    }
    get keys() {
        return this.entries.map(i => i[0]);
    }
    get values() {
        return this.entries.map(i => i[1]);
    }
    append(name, value, fileName) {
        if (typeof value === 'string' && fileName)
            throw new TypeError('cannot set fileName, value is not a Blob.');
        let item = typeof value === 'string' ? value : new File([value], fileName);
        this.entries.push([name, item]);
    }
    delete(name) {
        while (true) {
            const index = this.entries.findIndex(f => f[0] === name);
            if (index === -1)
                break;
            this.entries.splice(index, 1);
        }
    }
    get(name) {
        const found = this.entries.find(i => i[0] === name);
        if (found) {
            return found[1];
        }
    }
    getAll(name) {
        return this.entries.filter(i => i[0] === name).map(i => i[1]);
    }
    has(name) {
        return this.entries.findIndex(i => i[0] === name) > -1;
    }
    set(name, value, fileName) {
        this.delete(name);
        this.append(name, value, fileName);
    }
    forEach(callbackfn, thisArg) {
        this.entries.forEach(([key, value]) => callbackfn.call(thisArg, value, key, this));
    }
}
function createFormDataBody(boundary, entries) {
    let parts = [];
    for (const [key, entry] of entries) {
        parts.push(`--${boundary}`);
        parts.push(`\r\nContent-Disposition: form-data; name=${JSON.stringify(key)}`);
        if (isBlob(entry)) {
            if (entry.name) {
                parts.push(`; filename=${JSON.stringify(entry.name)}`);
            }
            const contentType = entry.type || 'application/octet-stream';
            parts.push(`\r\nContent-Type: ${encodeURI(contentType)}`);
            console.log('added content type');
        }
        parts.push('\r\n\r\n');
        parts.push(entry);
        parts.push('\r\n');
    }
    parts.push(`--${boundary}--`);
    return concatenateToStream(parts);
}

async function busboyToFormData(source, headers, config) {
    return await new Promise((resolve, reject) => {
        let pendingFiles = [];
        const mapped = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        const form = new BusBoy({
            headers: mapped,
            ...(config || {})
        });
        const formData = new FormData();
        form.on('field', (k, v) => {
            formData.append(k, v);
        });
        form.on('file', (k, stream, name, encoding, type) => {
            const tmpName = +new Date() + '-' + randomString();
            const tmpPath = path.join(os.tmpdir(), 'noderesponse-' + tmpName);
            const output = fs.createWriteStream(tmpPath, { autoClose: true });
            pendingFiles.push(promisifyEvent(output, 'open'));
            stream.pipe(output);
            const readStream = () => fs.createReadStream(tmpPath, { autoClose: true });
            formData.append(k, new Blob([readStream], { type }), name);
        });
        form.on('error', (err) => {
            reject(err);
        });
        form.on('finish', () => {
            Promise.all(pendingFiles).then(() => resolve(formData), reject);
        });
        source.stream().pipe(form);
    });
}

class Response {
    constructor(data, options) {
        this.options = {};
        this.stream = () => {
            return concatenateToStream(this.data);
        };
        if (options) {
            this.options = options;
        }
        this.data = data;
    }
    get headers() {
        return this.options.headers;
    }
    async blob() {
        return new Blob(this.data);
    }
    async arrayBuffer() {
        return await streamToBuffer(this.stream());
    }
    async formData() {
        const builder = this.options.createFormData || busboyToFormData;
        return await builder(this, this.headers, this.options.formDataConfig);
    }
    async json(encoding, start, end) {
        const text = await this.text(encoding, start, end);
        return JSON.parse(text);
    }
    async text(encoding, start, end) {
        const data = await this.arrayBuffer();
        const buffer = Buffer.from(data);
        return buffer.toString(encoding, start, end);
    }
}
function read(data, options) {
    return new Response(data, options);
}

export { Blob, File, FormData, Response, concatenateToStream, createFormDataBody, isBlob, read };
