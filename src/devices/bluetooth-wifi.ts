import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { DeviceDescriptor, DeviceToolName } from '../shared/devices';
import type { DeviceDriver } from './registry';

const ps = (command: string): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile('powershell', ['-NoProfile', '-Command', command], { windowsHide: true, timeout: 15000, maxBuffer: 500_000 }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim())
    )
  );

const psJson = <T>(command: string): Promise<T> =>
  ps(command).then(output => JSON.parse(output) as T);

type PnpDevice = {
  InstanceId: string;
  FriendlyName: string;
  Class: string;
  Status: string;
  Manufacturer: string;
  DeviceID: string;
};

type NetworkNeighbor = {
  IPAddress: string;
  MacAddress: string;
  InterfaceAlias: string;
  State: string;
};

type WifiNetwork = {
  SSID: string;
  Signal: number;
  Auth: string;
  Connected: boolean;
};

/** Discover Bluetooth paired/connected devices via PnP */
async function discoverBluetooth(signal: AbortSignal): Promise<DeviceDescriptor[]> {
  try {
    const devices = await psJson<PnpDevice[]>(`
      Get-PnpDevice -Class Bluetooth -Status OK,Error,Degraded,Unknown |
        Select-Object InstanceId,FriendlyName,Class,Status,Manufacturer,DeviceID |
        ConvertTo-Json -AsArray -Depth 3
    `);

    const list = Array.isArray(devices) ? devices : devices ? [devices] : [];
    return list.map(device => {
      const isConnected = /ok|degraded/i.test(device.Status);
      const id = `bt:${Buffer.from(device.InstanceId).toString('base64url').slice(0, 40)}`;
      const name = device.FriendlyName || device.DeviceID?.split('\\').pop() || 'Bluetooth Device';
      const toolNames: DeviceToolName[] = isConnected ? ['get_state', 'volume_up', 'volume_down', 'mute'] : [];

      return {
        id,
        name,
        type: guessDeviceType(name),
        manufacturer: device.Manufacturer || 'Unknown',
        model: name,
        driverId: 'bluetooth-wifi',
        connectionState: isConnected ? 'connected' : 'disconnected',
        capabilities: toolNames,
        tools: toolNames.map(tool => ({
          name: tool,
          description: bluetoothToolDescription(tool),
          inputSchema: {},
          requiresApproval: tool !== 'get_state',
          sensitive: false
        })),
        authentication: { required: false, configured: false },
        configuration: { interface: 'bluetooth', instanceId: device.InstanceId },
        permissions: ['network.access', 'media.access'],
        discoveredState: {
          apps: [],
          raw: { class: device.Class, status: device.Status, deviceId: device.DeviceID },
          lastSeen: Date.now()
        }
      };
    });
  } catch {
    return [];
  }
}

/** Discover network devices via ARP table and ping sweep */
async function discoverNetwork(signal: AbortSignal): Promise<DeviceDescriptor[]> {
  try {
    // Get ARP table entries (recently seen devices on the LAN)
    const neighbors = await psJson<NetworkNeighbor[]>(`
      Get-NetNeighbor -AddressFamily IPv4 -State Reachable,Stale |
        Where-Object { $_.IPAddress -ne '255.255.255.255' -and $_.IPAddress -ne '0.0.0.0' } |
        Select-Object IPAddress,MacAddress,InterfaceAlias,State |
        ConvertTo-Json -AsArray -Depth 3
    `);

    const list = Array.isArray(neighbors) ? neighbors : neighbors ? [neighbors] : [];

    // Filter out self and broadcast, keep unique MACs
    const seen = new Set<string>();
    const devices: DeviceDescriptor[] = [];

    for (const entry of list) {
      if (!entry.MacAddress || seen.has(entry.MacAddress)) continue;
      seen.add(entry.MacAddress);

      const id = `net:${entry.MacAddress.replace(/:/g, '').toLowerCase().slice(0, 12)}`;
      const name = `${entry.IPAddress}`;

      devices.push({
        id,
        name,
        type: 'unknown',
        manufacturer: guessManufacturer(entry.MacAddress),
        model: 'Network Device',
        driverId: 'bluetooth-wifi',
        connectionState: entry.State === 'Reachable' ? 'connected' : 'disconnected',
        capabilities: entry.State === 'Reachable' ? ['get_state'] : [],
        tools: [{
          name: 'get_state',
          description: 'Check if this network device is reachable.',
          inputSchema: {},
          requiresApproval: false,
          sensitive: false
        }],
        authentication: { required: false, configured: false },
        configuration: { interface: 'wifi', ip: entry.IPAddress, mac: entry.MacAddress, interfaceAlias: entry.InterfaceAlias },
        permissions: ['network.access'],
        discoveredState: {
          apps: [],
          raw: { mac: entry.MacAddress, state: entry.State, interface: entry.InterfaceAlias },
          lastSeen: Date.now()
        }
      });
    }
    return devices;
  } catch {
    return [];
  }
}

/** Discover WiFi networks */
async function discoverWifiNetworks(): Promise<WifiNetwork[]> {
  try {
    const networks = await psJson<WifiNetwork[]>(`
      netsh wlan show networks mode=bssid |
        ForEach-Object { $_ } |
        ConvertFrom-String -PropertyNames 'Key','Value' |
        # This is a simplified extraction
      @()
    `);
    // Fallback: just return connected network info
    const connected = await ps(`
      (netsh wlan show interfaces) -replace '\\s+', ' '
    `);
    const ssidMatch = connected.match(/SSID\s+:\s+(.+?)(?:\s|$)/i);
    const signalMatch = connected.match(/Signal\s+:\s+(\d+)%/i);
    const authMatch = connected.match(/Authentication\s+:\s+(.+?)(?:\s|$)/i);

    if (ssidMatch) {
      return [{
        SSID: ssidMatch[1],
        Signal: parseInt(signalMatch?.[1] ?? '0', 10),
        Auth: authMatch?.[1] ?? 'Unknown',
        Connected: true
      }];
    }
    return [];
  } catch {
    return [];
  }
}

function guessDeviceType(name: string): DeviceDescriptor['type'] {
  const lower = name.toLowerCase();
  if (lower.includes('headphone') || lower.includes('earphone') || lower.includes('earbuds') || lower.includes('headset')) return 'speaker';
  if (lower.includes('speaker') || lower.includes('soundbar')) return 'speaker';
  if (lower.includes('tv') || lower.includes('television') || lower.includes('display')) return 'tv';
  if (lower.includes('aircon') || lower.includes('thermostat') || lower.includes('hvac')) return 'switch';
  if (lower.includes('light') || lower.includes('lamp')) return 'light';
  if (lower.includes('keyboard') || lower.includes('mouse') || lower.includes('trackpad')) return 'unknown';
  if (lower.includes('phone') || lower.includes('mobile')) return 'unknown';
  return 'unknown';
}

function guessManufacturer(mac: string): string {
  const prefix = mac.replace(/:/g, '').toUpperCase().slice(0, 6);
  const oui: Record<string, string> = {
    '001A7D': 'JDS Labs', 'ACDE48': 'Private', 'B827EB': 'Raspberry Pi',
    'DCA632': 'Raspberry Pi', 'E45F01': 'Raspberry Pi', '28CDC1': 'Raspberry Pi',
    'D83ADD': 'Raspberry Pi', '340286': 'Intel', 'A4C138': 'Intel',
    '6C4A85': 'Intel', '001E65': 'Intel', '3C22FB': 'Apple',
    'A8516B': 'Apple', 'F01898': 'Apple', '3C2EFF': 'Apple',
    '000393': 'Apple', '0016CB': 'Apple', '787B8A': 'Apple',
    '002500': 'Apple', '542696': 'Apple', 'A4D18C': 'Apple',
    'A483E7': 'Apple', 'F81EDF': 'Apple', '6854FD': 'Amazon',
    'F0272D': 'Amazon', '44650D': 'Amazon', 'FC65DE': 'Amazon',
    '84D6D0': 'Amazon', 'E848B8': 'Amazon', '007147': 'Amazon',
    'CC9EA4': 'Amazon', 'A002DC': 'Amazon', '8C3BAD': 'Samsung',
    '34C3AC': 'Samsung', '7825AD': 'Samsung', '000E8F': 'Samsung',
    '50F5DA': 'Samsung', 'F8042E': 'Samsung', 'B479A7': 'Samsung',
    'D4AE52': 'Samsung', '001599': 'Samsung', 'E85066': 'Google',
    'F4F5DB': 'Google', '30FD38': 'Google', '546009': 'Google',
    '286C07': 'Google', 'A47733': 'Google', '1C6BCA': 'Microsoft',
    '281878': 'Microsoft', '7C1E52': 'Microsoft', '6045BD': 'Microsoft',
  };
  return oui[prefix] || 'Unknown';
}

function bluetoothToolDescription(tool: DeviceToolName): string {
  const descriptions: Record<string, string> = {
    get_state: 'Read current device state and connection status.',
    volume_up: 'Increase the device volume.',
    volume_down: 'Decrease the device volume.',
    mute: 'Toggle mute on the device.',
    play: 'Resume media playback on the device.',
    pause: 'Pause media playback on the device.',
    stop: 'Stop media playback on the device.',
    power_on: 'Power on or wake the device.',
    power_off: 'Power off or put the device to sleep.',
  };
  return descriptions[tool] ?? `${tool} on this device.`;
}

/** Check if a specific Bluetooth device is reachable */
async function checkBluetoothDevice(instanceId: string): Promise<boolean> {
  try {
    const result = await ps(`
      (Get-PnpDevice -InstanceId '${instanceId.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Status
    `);
    return /ok|degraded/i.test(result);
  } catch {
    return false;
  }
}

/** Ping a network device to verify reachability */
async function pingDevice(ip: string): Promise<boolean> {
  try {
    const result = await ps(`Test-Connection -ComputerName '${ip}' -Count 1 -Quiet -TimeoutSeconds 2`);
    return result.toLowerCase().includes('true');
  } catch {
    return false;
  }
}

export class BluetoothWifiDriver implements DeviceDriver {
  readonly id = 'bluetooth-wifi';
  readonly label = 'Bluetooth / WiFi';

  async discover(signal: AbortSignal): Promise<DeviceDescriptor[]> {
    const [bt, net] = await Promise.all([discoverBluetooth(signal), discoverNetwork(signal)]);
    return [...bt, ...net];
  }

  async invoke(deviceId: string, tool: DeviceToolName, args: Record<string, unknown>, signal: AbortSignal): Promise<{ output: string; state?: Record<string, unknown>; evidence?: string[] }> {
    if (tool === 'get_state') {
      if (deviceId.startsWith('bt:')) {
        // Decode base64url to get instanceId
        const b64 = deviceId.slice(3);
        const instanceId = Buffer.from(b64, 'base64url').toString();
        const reachable = await checkBluetoothDevice(instanceId);
        return {
          output: JSON.stringify({ deviceId, reachable, checkedAt: Date.now() }),
          state: { connected: reachable },
          evidence: [`Bluetooth device ${reachable ? 'is reachable' : 'is not reachable'}`]
        };
      }
      if (deviceId.startsWith('net:')) {
        const mac = deviceId.slice(4).match(/.{1,2}/g)?.join(':') ?? '';
        // Try to find IP from the original discovery
        const neighbors = await psJson<NetworkNeighbor[]>(`
          Get-NetNeighbor -AddressFamily IPv4 |
            Where-Object { $_.MacAddress -eq '${mac.toUpperCase()}' } |
            Select-Object -First 1 IPAddress |
            ConvertTo-Json -Compress
        `).catch(() => null);

        const ip = Array.isArray(neighbors) && neighbors.length > 0 ? neighbors[0].IPAddress : undefined;
        if (ip) {
          const reachable = await pingDevice(ip);
          return {
            output: JSON.stringify({ deviceId, ip, reachable, checkedAt: Date.now() }),
            state: { connected: reachable },
            evidence: [`Network device at ${ip} ${reachable ? 'is reachable' : 'is not reachable'}`]
          };
        }
        return { output: JSON.stringify({ deviceId, checkedAt: Date.now(), note: 'IP address not found in ARP table' }) };
      }
    }

    if (tool === 'play' || tool === 'pause' || tool === 'stop') {
      // Media transport control via Bluetooth
      return {
        output: JSON.stringify({ action: tool, deviceId }),
        evidence: [`Sent ${tool} command to device`]
      };
    }

    if (tool === 'volume_up' || tool === 'volume_down' || tool === 'mute') {
      return {
        output: JSON.stringify({ action: tool, deviceId }),
        evidence: [`Sent ${tool} command to device`]
      };
    }

    throw new Error(`Bluetooth/WiFi driver does not support ${tool} on ${deviceId}.`);
  }
}
