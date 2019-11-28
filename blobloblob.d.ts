import { PassThrough, Stream } from 'stream';

export interface Streamable {
	stream(): Stream;
}
export declare function concatenateToStream(parts: BlobPart[]): PassThrough;
export declare function isBlob(value: any): value is Blob;
export interface FileProperties extends BlobProperties {
	lastModified?: number;
}
export interface BlobProperties {
	size?: number;
	type: string;
}
export interface File extends Blob {
	readonly lastModified: number;
	readonly name: string;
}
export declare var File: {
	prototype: File;
	new (fileBits: BlobPart[], fileName: string, options?: FileProperties): File;
};
export interface Blob {
	readonly size: number;
	readonly type: string;
	slice(start?: number, end?: number, contentType?: string): Blob;
}
export declare var Blob: {
	prototype: Blob;
	new (blobParts?: BlobPart[], options?: BlobProperties): Blob;
};
export declare type BlobPart = Blob | ArrayBufferView | ArrayBuffer | Streamable | Stream | (() => Stream) | string;
export declare type FormDataEntryValue = string | File;
export declare class FormData {
	constructor();
	readonly entries: [string, FormDataEntryValue][];
	readonly boundary: string;
	readonly headers: { [key: string]: string };
	readonly keys: string[];
	readonly values: FormDataEntryValue[];
	append(name: string, value: string | Blob, fileName?: string): void;
	delete(name: string): void;
	get(name: string): FormDataEntryValue;
	getAll(name: string): FormDataEntryValue[];
	has(name: string): boolean;
	set(name: string, value: string | Blob, fileName?: string): void;
	forEach(callbackfn: (value: FormDataEntryValue, key: string, parent: FormData) => void, thisArg?: any): void;
	stream: () => import("stream").PassThrough;
}
export declare function createFormDataBody(boundary: string, entries: Array<[string, FormDataEntryValue]>): import("stream").PassThrough;
export interface ResponseConfig {
	headers?: any;
	formDataConfig?: any;
	createFormData?: (stream: Streamable, headers: any) => Promise<FormData>;
}
export declare class Response implements Streamable {
	private options;
	private data;
	constructor(data: BlobPart[], options?: ResponseConfig);
	stream: () => import("stream").PassThrough;
	readonly headers: any;
	blob(): Promise<Blob>;
	arrayBuffer(): Promise<ArrayBuffer>;
	formData(): Promise<FormData>;
	json(encoding?: string, start?: number, end?: number): Promise<any>;
	text(encoding?: string, start?: number, end?: number): Promise<string>;
}
export declare function read(data: BlobPart[], options?: ResponseConfig): Response;
