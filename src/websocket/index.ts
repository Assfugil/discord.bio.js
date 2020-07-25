import { client } from 'websocket'
import fetch from 'node-fetch'
import Profile from "../structures/Profile";
import { performance } from 'perf_hooks'
import { headers } from '../util/Constants';
import Presence from '../structures/Presence';
import { EventEmitter } from 'events';
import ProfileEvents from '../structures/ProfileEvents'
const socket = new client()
/**Connect to this profile's websocket */
async function connect(this: Profile) {
  this.ws.socket = socket
  socket.on('connectFailed', console.error)
  const info = await fetch(`https://${this.bio.options.ws.gateway}/?EIO=3&transport=polling`, {
    headers: {
      'user-agent': headers['user-agent'] as any,
    }
  }).then(res => res.text()).then(text => text.replace('96:0', '')).then(JSON.parse)
  socket.connect(`wss://${this.bio.options.ws.gateway}/bio_ws/?EIO=3&transport=websocket&sid=${info.sid}`)
  socket.on('connect', connection => {
    this.emit(ProfileEvents.CONNECT)
    this.once('viewCountUpdate', count => this.emit(ProfileEvents.SUBSCRIBE, count))
    connection.on('close', () => {
      this.bio.emit('debug', ' Websocket Connection Closed');
      this.emit(ProfileEvents.CLOSE)
    });
    let sent2: number
    setInterval(() => {
      connection.send('2')
      sent2 = performance.now()
    }, info.pingInterval)
    //init
    const now = performance.now()
    connection.send('2probe')
    connection.send('5')
    connection.on('message', (message) => {
      if (message.type !== 'utf8') return
      const msg = message.utf8Data as string
      if (msg === '3probe') this.ws.ping = performance.now() - now
      else if (msg === '3') this.ws.ping = performance.now() - sent2
      if (['3probe', '3', '40'].includes(msg)) return
      this.emit('raw', msg)
      const [event, data]: [string, any] = JSON.parse(msg.substr(2))
      switch (event) {
        case 'TOTAL_VIEWING': this.emit(ProfileEvents.TOTAL_VIEWING, data); break
        case 'PRESENCE': {
          data.user = this.discord
          const newPresence = new Presence(this.bio, data)
          const oldPresence = this.discord.presence
          this.discord.presence = newPresence
          this.emit(ProfileEvents.PRESENCE, oldPresence, newPresence)
        }; break
        case 'PROFILE_UPDATE': {
          const oldProfile = {
            user: Object.assign({}, this.user),
            discord: this.discord
          }
          Object.assign(oldProfile, new EventEmitter())
          this._patch(data)
          this.emit(ProfileEvents.PROFILE_UPDATE, oldProfile, this)
        }; break
        case 'BANNER_UPDATE': {
          if (!data) this.user.details.banner = null;
          else this.user.details.banner = "https://s3.eu-west-2.amazonaws.com/discord.bio/banners/" + this.discord.id
          this.emit(ProfileEvents.BANNER_UPDATE, data)
        }; break
        //SOON tm
        case 'PROFILE_LIKE': {
          this.user.details.likes += 1
          this.emit(ProfileEvents.PROFILE_LIKE, this.bio.profiles.get(data)?.discord || data)
        }; break
        case 'PROFILE_UNLIKED': {
          this.user.details.likes -= 1
          this.emit(ProfileEvents.PROFILE_UNLIKE, this.bio.profiles.get(data)?.discord || data)
        }; break
        case 'PROFILE_UNLIKE': {
          this.user.details.likes -= 1
          this.emit(ProfileEvents.PROFILE_UNLIKE, this.bio.profiles.get(data)?.discord || data)
        }; break
        default: console.error(`discord.bio: Received unknown event "${event}", event data follows:\n${data}`)
      }
    });
    connection.send("42" + JSON.stringify(["VIEWING", this.discord.id]))
  })
}
export = connect
