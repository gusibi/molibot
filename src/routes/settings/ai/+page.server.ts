import { redirect } from '@sveltejs/kit';

export function load() {
    throw redirect(302, '/settings/ai/routing');
}
