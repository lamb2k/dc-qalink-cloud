// Windows Firewall, the silent kind: with no rule for the bridge's Python and no prompt shown, Windows drops the
// console's UDP and the bridge hears nothing ("searching" for ever). The app suspects it when the person set up a
// Dreamcast over the broadband adapter, the bridge may talk to the network, it has listened for a while, and not one
// console beacon arrived. tests/data.test.ts checks this rule.
import { bget } from './bridge-client';
import { ENDPOINTS, type C1Discovery } from './bridge-api';

export const FIREWALL_WAIT_S = 20;

export interface FirewallInputs {
  /** how the Dreamcast is linked (settings) */
  connection: string;
  /** the bridge may talk to a console on the network (settings: Dreamcast on the network) */
  lanAllowed: boolean;
  /** seconds the bridge has answered as listening */
  listeningS: number;
  /** consoles (not Flycast) the bridge has heard */
  consolesHeard: number;
  /** the app is live with a console already (then the packets do arrive) */
  linkedToConsole: boolean;
  /** a firewall rule for the bridge's Python is known to exist */
  ruleKnown?: boolean;
}

export function firewallSuspect(i: FirewallInputs, waitS = FIREWALL_WAIT_S): boolean {
  return i.connection === 'bba' && i.lanAllowed && !i.linkedToConsole && !i.ruleKnown && i.consolesHeard === 0 && i.listeningS >= waitS;
}

/** Polls the bridge's discovery while a page shows; `listeningS` counts from the first answer that says listening. */
export class BeaconWatch {
  listeningS = 0; consolesHeard = 0; answered = false;
  private since = 0; private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private base: () => string, private changed: () => void, private now: () => number = () => performance.now()) {}
  start(everyMs = 2000): void { if (!this.timer) { void this.poll(); this.timer = setInterval(() => void this.poll(), everyMs); } }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async poll(): Promise<void> {
    let d: C1Discovery | null = null;
    try { d = await bget<C1Discovery>(this.base(), ENDPOINTS.discovery, 1500); } catch { d = null; }
    const was = `${this.answered}|${Math.floor(this.listeningS)}|${this.consolesHeard}`;
    this.answered = !!d;
    if (d?.listening) { if (!this.since) this.since = this.now(); this.listeningS = (this.now() - this.since) / 1000; } else { this.since = 0; this.listeningS = 0; }
    this.consolesHeard = d ? d.seen.filter((x) => x.kind === 'console').length : 0;
    if (`${this.answered}|${Math.floor(this.listeningS)}|${this.consolesHeard}` !== was) this.changed();
  }
}

/** what to tell the person, in their words */
export const FIREWALL_HELP = 'Windows may be dropping the console\'s packets without asking: the bridge has listened for a while and heard no Dreamcast. '
  + 'Allow the bridge\'s Python through Windows Firewall for Private networks (inbound UDP), and check that this network is set to Private in Windows settings.';
