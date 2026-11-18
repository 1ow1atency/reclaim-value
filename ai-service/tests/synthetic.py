"""Synthetic material-like images for tests (not real photos)."""
import io, numpy as np
from PIL import Image
rng = np.random.default_rng(0)
def png(a):
    b=io.BytesIO(); Image.fromarray(np.clip(a,0,255).astype('uint8')).save(b,'PNG'); return b.getvalue()
def noise(base, amp, shape=(200,200)):
    return np.array(base,float)[None,None,:] + rng.normal(0,amp,shape+(1,))
def brick():
    a=noise((178,72,48),12)
    a[::25,:]=(200,195,185); 
    for r in range(0,200,25):
        off = 0 if (r//25)%2==0 else 30
        a[r:r+25, off::60]=(200,195,185)
    return a
def wood():
    a=noise((150,100,55),8); x=np.arange(200); a+= (np.sin(x/3)[None,:,None]*15); return a
def concrete():
    return noise((140,140,136),18)
def steel():
    a=noise((95,98,102),10); a[40:80,30:120]=(140,70,30); a[::20,:]=(40,40,45); a[120:150,100:180]=(130,62,28); return a
def glass():
    a=noise((175,205,225),3); return a
def tiles():
    a=noise((235,233,228),3); a[::40,:]=(120,120,120); a[:,::40]=(120,120,120); return a
SAMPLES={k:png(f()) for k,f in dict(brick=brick,wood=wood,concrete=concrete,steel=steel,glass=glass,tiles=tiles).items()}
