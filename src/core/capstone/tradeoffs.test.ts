import { describe, expect, it } from 'vitest'
import type { Capstone } from './types'
import { CHAT } from '../../topics/chat/build'
import { DROPBOX } from '../../topics/dropbox/build'
import { KEY_VALUE_STORE } from '../../topics/key-value-store/build'
import { NEWS_FEED } from '../../topics/news-feed/build'
import { NOTIFICATIONS } from '../../topics/notifications/build'
import { PAYMENTS } from '../../topics/payments/build'
import { RIDE_SHARING } from '../../topics/ride-sharing/build'
import { TWITTER_TIMELINE } from '../../topics/twitter-timeline/build'
import { URL_SHORTENER } from '../../topics/url-shortener/build'
import { VIDEO_STREAMING } from '../../topics/video-streaming/build'
import { WEB_CRAWLER } from '../../topics/web-crawler/build'
import { WHATSAPP } from '../../topics/whatsapp/build'
import { YOUTUBE } from '../../topics/youtube/build'

const CAPSTONES: Capstone[] = [CHAT, DROPBOX, KEY_VALUE_STORE, NEWS_FEED, NOTIFICATIONS, PAYMENTS, RIDE_SHARING, TWITTER_TIMELINE, URL_SHORTENER, VIDEO_STREAMING, WEB_CRAWLER, WHATSAPP, YOUTUBE]

// Every choice in a capstone names its trade, one gain and one cost per option.
describe('capstone setting tradeoffs', () => {
  for (const c of CAPSTONES) {
    for (const task of [c.first, c.scale]) {
      for (const s of task.settings ?? []) {
        if (!s.options) continue
        it(`${c.id} · ${s.id}`, () => {
          expect(s.tradeoffs?.length).toBe(s.options!.length)
          for (const t of s.tradeoffs!) expect(t.gain && t.cost).toBeTruthy()
        })
      }
    }
  }
})
