import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const loaderPath = path.resolve('scripts/md-loader.js');
register(pathToFileURL(loaderPath));
console.log('Registered custom md-loader at:', loaderPath);
