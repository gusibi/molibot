import type { RequestHandler } from "@sveltejs/kit";
import { getRoomService } from "$lib/server/rooms/runtime.js";
import { handleRoomRequest } from "$lib/server/app/desktopRooms.js";
export const GET: RequestHandler = ({ request, url }) => handleRoomRequest(getRoomService(), request, url);
export const POST: RequestHandler = GET;
