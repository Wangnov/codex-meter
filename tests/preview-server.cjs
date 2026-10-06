const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  const allowed=name==='/tests/preview.html'||/^\/codex-meter-extension\/[\w/-]+\.(js|css)$/.test(name);
  if(!allowed){res.writeHead(404);return res.end();}
  const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');
    res.end(data);
  });
}).listen(18743,'127.0.0.1',()=>console.log('Fixture preview: http://127.0.0.1:18743/tests/preview.html'));
