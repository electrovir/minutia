// cspell:words opfs

/** Cookie name / storage key / IndexedDB key / cache key under which the per-run marker is written. */
const markerStorageKey = 'persistenceMarker';

const indexedDbName = 'persistenceDb';
const indexedDbStoreName = 'markers';
const cacheStorageName = 'persistence-cache';
const cacheStorageMarkerUrl = 'persistence-marker';
const serviceWorkerUrl = 'sw.js';
const opfsFileName = 'persistence-marker.txt';

/**
 * Every browser persistence mechanism this page can exercise from a first-party script.
 *
 * @category Internal
 */
export enum PersistenceMechanism {
    Cookie = 'cookie',
    LocalStorage = 'localStorage',
    SessionStorage = 'sessionStorage',
    IndexedDb = 'indexedDb',
    CacheStorage = 'cacheStorage',
    ServiceWorker = 'serviceWorker',
    Opfs = 'opfs',
}

/**
 * User-facing text for each {@link PersistenceMechanism}.
 *
 * @category Internal
 */
export const persistenceMechanismLabels: Record<PersistenceMechanism, string> = {
    [PersistenceMechanism.Cookie]: 'Cookies',
    [PersistenceMechanism.LocalStorage]: 'localStorage',
    [PersistenceMechanism.SessionStorage]: 'sessionStorage',
    [PersistenceMechanism.IndexedDb]: 'IndexedDB',
    [PersistenceMechanism.CacheStorage]: 'Cache Storage',
    [PersistenceMechanism.ServiceWorker]: 'Service Worker registration',
    [PersistenceMechanism.Opfs]: 'Origin Private File System',
};

/**
 * A single mechanism's seed (write the marker) and verify (read the marker back) operations.
 *
 * @category Internal
 */
export type PersistenceTest = Readonly<{
    /** Writes the marker, throwing when the mechanism is unavailable in this browser or context. */
    seed: (marker: string) => void | Promise<void>;
    /** Reads the marker back, returning whether the stored value still matches. */
    verify: (marker: string) => boolean | Promise<boolean>;
}>;

function seedCookie(marker: string): void {
    /** One year, so this is a persistent cookie rather than a session-only cookie. */
    const oneYearSeconds = 60 * 60 * 24 * 365;
    // eslint-disable-next-line unicorn/no-document-cookie -- a real page has no automation cookie API; document.cookie is the standard way to set one.
    document.cookie = `${markerStorageKey}=${marker}; path=/; max-age=${oneYearSeconds}; SameSite=Lax`;
}
function verifyCookie(marker: string): boolean {
    const entry = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith(`${markerStorageKey}=`));
    return entry === `${markerStorageKey}=${marker}`;
}

function seedLocalStorage(marker: string): void {
    localStorage.setItem(markerStorageKey, marker);
}
function verifyLocalStorage(marker: string): boolean {
    return localStorage.getItem(markerStorageKey) === marker;
}

function seedSessionStorage(marker: string): void {
    sessionStorage.setItem(markerStorageKey, marker);
}
function verifySessionStorage(marker: string): boolean {
    return sessionStorage.getItem(markerStorageKey) === marker;
}

function openMarkerDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(indexedDbName, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(indexedDbStoreName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(
                new Error(
                    `open failed (${request.error?.name || 'unknown'}): ${request.error?.message || 'no message'}`,
                ),
            );
    });
}
async function seedIndexedDb(marker: string): Promise<void> {
    const database = await openMarkerDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(indexedDbStoreName, 'readwrite');
            transaction.objectStore(indexedDbStoreName).put(marker, markerStorageKey);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(new Error('write transaction failed.'));
        });
    } finally {
        database.close();
    }
}
async function verifyIndexedDb(marker: string): Promise<boolean> {
    const database = await openMarkerDatabase();
    try {
        const stored = await new Promise<unknown>((resolve, reject) => {
            const transaction = database.transaction(indexedDbStoreName, 'readonly');
            const getRequest = transaction.objectStore(indexedDbStoreName).get(markerStorageKey);
            getRequest.onsuccess = () => resolve(getRequest.result);
            getRequest.onerror = () => reject(new Error('read failed.'));
        });
        return stored === marker;
    } finally {
        database.close();
    }
}

async function seedCacheStorage(marker: string): Promise<void> {
    const cache = await caches.open(cacheStorageName);
    await cache.put(cacheStorageMarkerUrl, new Response(marker));
}
async function verifyCacheStorage(marker: string): Promise<boolean> {
    const cache = await caches.open(cacheStorageName);
    const response = await cache.match(cacheStorageMarkerUrl);
    return response != undefined && (await response.text()) === marker;
}

async function seedServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers are not supported in this browser.');
    }
    await navigator.serviceWorker.register(serviceWorkerUrl);
    /**
     * Bound the wait for activation: on some remote/virtualized browsers `ready` never resolves
     * even though registration succeeded, which would otherwise hang the whole run.
     */
    await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => {
            setTimeout(resolve, 5000);
        }),
    ]);
}
async function verifyServiceWorker(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
        return false;
    }
    return (await navigator.serviceWorker.getRegistration()) != undefined;
}

async function seedOpfs(marker: string): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(opfsFileName, {
        create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(marker);
    await writable.close();
}
async function verifyOpfs(marker: string): Promise<boolean> {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(opfsFileName);
    const file = await fileHandle.getFile();
    return (await file.text()) === marker;
}

/**
 * The seed and verify operations for every {@link PersistenceMechanism}.
 *
 * @category Internal
 */
export const persistenceTests: Record<PersistenceMechanism, PersistenceTest> = {
    [PersistenceMechanism.Cookie]: {
        seed: seedCookie,
        verify: verifyCookie,
    },
    [PersistenceMechanism.LocalStorage]: {
        seed: seedLocalStorage,
        verify: verifyLocalStorage,
    },
    [PersistenceMechanism.SessionStorage]: {
        seed: seedSessionStorage,
        verify: verifySessionStorage,
    },
    [PersistenceMechanism.IndexedDb]: {
        seed: seedIndexedDb,
        verify: verifyIndexedDb,
    },
    [PersistenceMechanism.CacheStorage]: {
        seed: seedCacheStorage,
        verify: verifyCacheStorage,
    },
    [PersistenceMechanism.ServiceWorker]: {
        seed: seedServiceWorker,
        verify: verifyServiceWorker,
    },
    [PersistenceMechanism.Opfs]: {
        seed: seedOpfs,
        verify: verifyOpfs,
    },
};
