"""A read-only, seekable file over HTTP range requests, with a block cache, so tifffile can read only the tiles it
needs from a large remote GeoTIFF. Blocks are cached on disk under data/raw/http_cache so a rerun costs nothing."""
import hashlib, os, urllib.request

UA = 'lunar-window-browser-build'


class HTTPFile:
    BLOCK = 1 << 20

    def __init__(self, url, cache_dir):
        self.url = self._resolve(url)
        self.pos = 0
        self.cache_dir = os.path.join(cache_dir, hashlib.sha1(url.encode()).hexdigest()[:16])
        os.makedirs(self.cache_dir, exist_ok=True)
        size_file = os.path.join(self.cache_dir, 'size')
        if os.path.exists(size_file):
            self.size = int(open(size_file).read())
        else:
            req = urllib.request.Request(self.url, method='HEAD', headers={'User-Agent': UA})
            self.size = int(urllib.request.urlopen(req, timeout=60).headers['Content-Length'])
            open(size_file, 'w').write(str(self.size))
        self.mem = {}
        self.fetched = 0

    @staticmethod
    def _resolve(url):
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA})
        return urllib.request.urlopen(req, timeout=60).geturl()

    def _block(self, k):
        if k in self.mem:
            return self.mem[k]
        path = os.path.join(self.cache_dir, '%06d' % k)
        if os.path.exists(path):
            data = open(path, 'rb').read()
        else:
            a = k * self.BLOCK
            b = min(self.size, a + self.BLOCK) - 1
            req = urllib.request.Request(self.url, headers={'User-Agent': UA, 'Range': 'bytes=%d-%d' % (a, b)})
            data = urllib.request.urlopen(req, timeout=120).read()
            if len(data) != b - a + 1:
                raise IOError('short range read at block %d' % k)
            open(path, 'wb').write(data)
            self.fetched += len(data)
        if len(self.mem) > 256:
            self.mem.clear()
        self.mem[k] = data
        return data

    # file protocol used by tifffile
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def tell(self):
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            k, o = divmod(self.pos, self.BLOCK)
            chunk = self._block(k)[o:o + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)

    def seekable(self):
        return True

    def readable(self):
        return True

    def close(self):
        pass

    @property
    def closed(self):
        return False

    @property
    def name(self):
        return self.url
