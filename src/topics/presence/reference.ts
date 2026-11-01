import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Presence is the green dot and “last seen”. The server keeps one fact per user, online or offline, and tells the people who care when it changes. Knowing the fact is true is the hard part: a dead phone cannot say goodbye.',
    'Hello and goodbye is not enough. If the phone dies, loses signal or the app is killed, the server never hears goodbye and shows “online” for ever. Use heartbeats: the client pings every few seconds, and the server marks a user offline after a few missed pings. Three missed pings is a common timeout, because one missed ping is often only a slow network.',
    'Choose the interval by trade-off. A short interval notices a dead phone fast and costs more writes and more battery. A long interval is cheap and slow. A million users pinging every 5 seconds is 200,000 writes a second, so tune the interval to what the product needs: nobody needs a green dot to be right within one second.',
    'Phones drop and return all the time: tunnels, lifts, a switch from wifi to mobile data. Without care, the dot blinks and every blink is a fan-out to all contacts. Add a grace period: wait a few seconds after a missed ping before declaring a user offline, and cancel if a ping arrives. A longer grace period hides more bumps and makes real changes later.',
    'Fan-out is the expensive part. A user with 300 contacts who changes status every few minutes causes hundreds of messages. Send updates only to people who are looking: those with the chat or contact list open. Everyone else asks for the status when they open the chat. Subscribe on open and unsubscribe on close.',
    'Keep presence in memory with an expiry, for example Redis keys with a time to live that each ping refreshes. A key that expires means offline, so the timeout costs nothing. Presence is short-lived and fine to lose: after a restart the next heartbeat from each client rebuilds the state within one interval. Writing every ping to a disk database is usually too slow and keeps data nobody needs.',
    'After an outage, all clients reconnect at once. Spread them with random delays and backoff, and avoid broadcasting every status change to everyone while the system recovers. “Last seen” is the same data with a different view: store the time of the last ping and show it only to people allowed to see it.',
  ],
  cards: [
    { title: 'The idea', body: 'The client pings every few seconds. The server marks it offline after about three missed pings, and tells only the people looking.' },
    { title: 'Why not just goodbye?', body: 'A dead phone, a lost signal or a killed app sends no goodbye. The server would show “online” for ever.' },
    { title: 'Interval', body: 'Short notices fast and costs writes and battery. Long is cheap and slow. A million users at 5 seconds is 200,000 writes a second.' },
    { title: 'Grace period', body: 'Wait a few seconds before saying “offline”, and say nothing if a ping arrives. It hides tunnels and wifi switches, and delays real news a little.' },
    { title: 'Fan-out', body: 'Do not send a status to all 300 contacts. Send it to the chats on screen, and let everyone else ask when they open the chat.' },
    { title: 'Where it lives', body: 'In memory with an expiry, such as Redis keys with a time to live. Losing it is fine: the next ping from each phone rebuilds it.' },
    { title: 'In the real world', body: 'WhatsApp, Slack and Discord show online dots and “last seen” this way, with heartbeats over a persistent connection and updates sent to open chats.' },
  ],
}
