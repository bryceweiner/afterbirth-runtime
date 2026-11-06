import json
d=json.load(open('live/index.json'))
pks=set()
for x in d['agents']:
    if x.get('stale'): continue
    s=x.get('solana')
    pk=s.get('public_key') if isinstance(s,dict) else (s if isinstance(s,str) else None)
    if pk: pks.add(pk)
open('C:/Users/User/birth-image/runtime/live-pks.txt','w').write('\n'.join(sorted(pks)))
print(len(pks))
