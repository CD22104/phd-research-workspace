// Cloudflare Pages Functions 入口：/api/* 全部交给 Hono 应用
import { app } from '../../server/app';

export const onRequest: PagesFunction<any> = (ctx) => app.fetch(ctx.request, ctx.env, ctx as any);
