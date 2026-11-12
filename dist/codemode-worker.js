var q=require("url").pathToFileURL(__filename).href;var U=require("node:worker_threads");function J(i){return typeof i=="object"&&i!==null&&i.type==="result"}function W(i){return{clock_time_get(o,a,l){let u=i(),c=new DataView(u.buffer);if(o===0||o===1){let p=BigInt(Date.now())*1000000n;return c.setBigUint64(l,p,!0),0}return 52},fd_write(o,a,l,u){let c=i(),p=new DataView(c.buffer),h=new Uint8Array(c.buffer),g=0;if(o!==1&&o!==2)return 8;for(let d=0;d<l;d++){let w=p.getUint32(a+d*8,!0),P=p.getUint32(a+d*8+4,!0),S=h.slice(w,w+P),y=new TextDecoder().decode(S);o===1?typeof process<"u"&&process.stdout?process.stdout.write(y):console.log(y):typeof process<"u"&&process.stderr?process.stderr.write(y):console.error(y),g+=P}return p.setUint32(u,g,!0),0},fd_close(o){return 52},fd_fdstat_get(o,a){let l=i(),u=new DataView(l.buffer);return o===1||o===2?(u.setUint8(a,2),u.setUint16(a+2,0,!0),u.setBigUint64(a+8,0n,!0),u.setBigUint64(a+16,0n,!0),0):8},fd_seek(o,a,l,u){return 52},random_get(o,a){let l=i(),u=new Uint8Array(l.buffer,o,a);if(typeof crypto<"u"&&crypto.getRandomValues)crypto.getRandomValues(u);else for(let c=0;c<a;c++)u[c]=Math.floor(Math.random()*256);return 0}}}var te=new TextDecoder;function re(i,e){let t=new Uint8Array(i.buffer),r=e;for(;t[r]!==0;)r++;if(r===e)return{};let s=te.decode(t.slice(e,r)),n={};for(let o of s.split(`
`)){let a=o.indexOf("=");a>0&&(n[o.slice(0,a)]=o.slice(a+1))}return n}function se(i,e){let t=`qjs_ext_${i.name.replace(/-/g,"_")}_versions`,r=i.instance.exports[t];if(typeof r!="function")return;let s=r();if(s!==0)return re(e,s)}function N(i,e){let t=0,r=0;for(;e.value<i.length;){let s=i[e.value++];if(t|=(s&127)<<r,(s&128)===0)break;r+=7}return t}function ne(i){let e=WebAssembly.Module.customSections(i,"dylink.0");if(e.length===0)return null;let t=new Uint8Array(e[0]),r={value:0},s={memorySize:0,memoryAlignment:0,tableSize:0,tableAlignment:0,needed:[]};for(;r.value<t.length;){let n=N(t,r),o=N(t,r),a=r.value+o;if(n===1)s.memorySize=N(t,r),s.memoryAlignment=N(t,r),s.tableSize=N(t,r),s.tableAlignment=N(t,r);else if(n===2){let l=N(t,r);for(let u=0;u<l;u++){let c=N(t,r),p=new TextDecoder().decode(t.slice(r.value,r.value+c));r.value+=c,s.needed.push(p)}}r.value=a}return s}async function F(i,e,t,r,s,n){let o;i.wasm instanceof WebAssembly.Module?o=i.wasm:o=await WebAssembly.compile(i.wasm);let a=ne(o);if(!a)throw new Error(`Extension "${i.name}" is not a WASM shared library (missing dylink.0 section)`);let l=e.memory,u=e.__indirect_function_table,c=e.__stack_pointer,p=e.malloc;if(!l)throw new Error("Main module does not export memory");if(!u)throw new Error("Main module does not export __indirect_function_table");if(!p)throw new Error("Main module does not export malloc");let h,g;if(n)h=n.memoryBase,g=n.tableBase;else if(a.memorySize>0){if(h=p(a.memorySize),h===0)throw new Error(`Failed to allocate ${a.memorySize} bytes for extension "${i.name}"`);new Uint8Array(l.buffer,h,a.memorySize).fill(0)}else h=0;n?(g=n.tableBase,g+a.tableSize>u.length&&u.grow(g+a.tableSize-u.length)):(g=u.length,a.tableSize>0&&u.grow(a.tableSize));let d=WebAssembly.Module.imports(o),w={env:{},"GOT.mem":{},"GOT.func":{}};if(d.some(f=>f.module==="wasi_snapshot_preview1")){let f=i.wasi&&s?i.wasi(s):void 0;w.wasi_snapshot_preview1={...t,...f,...r}}let S=new Set(WebAssembly.Module.exports(o).filter(f=>f.kind==="function").map(f=>f.name)),y=new Set;for(let f of d)if(f.module==="env"){if(f.name==="memory"&&f.kind==="memory")w.env.memory=l;else if(f.name==="__indirect_function_table"&&f.kind==="table")w.env.__indirect_function_table=u;else if(f.name==="__memory_base"&&f.kind==="global")w.env.__memory_base=new WebAssembly.Global({value:"i32",mutable:!1},h);else if(f.name==="__table_base"&&f.kind==="global")w.env.__table_base=new WebAssembly.Global({value:"i32",mutable:!1},g);else if(f.name==="__stack_pointer"&&f.kind==="global")w.env.__stack_pointer=c;else if(f.kind==="function"){let E=e[f.name];E&&typeof E=="function"?w.env[f.name]=E:(y.add(f.name),w.env[f.name]=()=>{throw new Error(`Extension "${i.name}" called unresolved symbol: env.${f.name}`)})}else if(f.kind==="global"){let E=e[f.name];E instanceof WebAssembly.Global?w.env[f.name]=E:w.env[f.name]=new WebAssembly.Global({value:"i32",mutable:!0},0)}}else if(f.module==="GOT.mem"&&f.kind==="global")w["GOT.mem"][f.name]=new WebAssembly.Global({value:"i32",mutable:!0},0);else if(f.module==="GOT.func"&&f.kind==="global"){let E=e[f.name];if(E&&typeof E=="function"){let R=u.length;u.grow(1),u.set(R,E),w["GOT.func"][f.name]=new WebAssembly.Global({value:"i32",mutable:!0},R)}else w["GOT.func"][f.name]=new WebAssembly.Global({value:"i32",mutable:!0},0)}let _=[...y].filter(f=>S.has(f)),x={};for(let f of _){let E={target:null};x[f]=E,w.env[f]=(...R)=>{if(!E.target)throw new Error(`Extension "${i.name}" called unresolved symbol during init: env.${f}`);return E.target(...R)}}let j=await WebAssembly.instantiate(o,w),b=j.exports;for(let f of _){let E=b[f];typeof E=="function"&&(x[f].target=E)}typeof b.__wasm_apply_data_relocs=="function"&&b.__wasm_apply_data_relocs(),typeof b.__wasm_call_ctors=="function"&&b.__wasm_call_ctors();let k=i.initFn??`qjs_ext_${i.name.replace(/-/g,"_")}_init`,v={name:i.name,module:o,instance:j,dylink:a,memoryBase:h,tableBase:g,initFn:k};return v.versions=se(v,l),v}function V(i,e){let t=i.instance.exports[i.initFn];if(typeof t!="function")throw new Error(`Extension "${i.name}" does not export init function "${i.initFn}"`);let r=e.qjs_get_context_ptr(),s=e.qjs_get_runtime_ptr(),n=t(r,s);if(n!==0)throw new Error(`Extension "${i.name}" init function returned error code ${n}`)}async function G(i,e,t,r,s,n){let o=[];for(let a of e){let l=i.find(c=>c.name===a.name);if(!l)throw new Error(`Extension "${a.name}" required by snapshot but not provided`);let u=await F(l,t,r,s,n,{memoryBase:a.memoryBase,tableBase:a.tableBase});u.initFn=a.initFn,o.push(u)}return o}var X="3.6.2";var A=function(i,e,t){if(e!=null){if(typeof e!="object"&&typeof e!="function")throw new TypeError("Object expected.");var r,s;if(t){if(!Symbol.asyncDispose)throw new TypeError("Symbol.asyncDispose is not defined.");r=e[Symbol.asyncDispose]}if(r===void 0){if(!Symbol.dispose)throw new TypeError("Symbol.dispose is not defined.");r=e[Symbol.dispose],t&&(s=r)}if(typeof r!="function")throw new TypeError("Object not disposable.");s&&(r=function(){try{s.call(this)}catch(n){return Promise.reject(n)}}),i.stack.push({value:e,dispose:r,async:t})}else t&&i.stack.push({async:!0});return e},T=(function(i){return function(e){function t(o){e.error=e.hasError?new i(o,e.error,"An error was suppressed during disposal."):o,e.hasError=!0}var r,s=0;function n(){for(;r=e.stack.pop();)try{if(!r.async&&s===1)return s=0,e.stack.push(r),Promise.resolve().then(n);if(r.dispose){var o=r.dispose.call(r.value);if(r.async)return s|=2,Promise.resolve(o).then(n,function(a){return t(a),n()})}else s|=1}catch(a){t(a)}if(s===1)return e.hasError?Promise.reject(e.error):Promise.resolve();if(e.hasError)throw e.error}return n()}})(typeof SuppressedError=="function"?SuppressedError:function(i,e,t){var r=new Error(t);return r.name="SuppressedError",r.error=i,r.suppressed=e,r}),H=512*1024;var M={DATE:1,EVAL:2,REGEXP:4,JSON:8,PROXY:16,MAP_SET:32,TYPED_ARRAYS:64,PROMISE:128,BIG_INT:256,WEAK_REF:512,PERFORMANCE:1024,DOM_EXCEPTION:2048,ATOB_BTOA:4096,ALL:4294967295},L=1363825491,B=2,D=24,I=class i{exports;module;instance;encoder=new TextEncoder;decoder=new TextDecoder;disposed=!1;hostCallbacks=new Map;nextInternalId=1;interruptHandler=null;unhandledRejectionHandler=null;moduleNormalizeHandler=null;moduleLoadHandler=null;timezoneOffsetHandler=null;_global=null;_versions=null;_undefined=null;_null=null;_true=null;_false=null;_ownedHandles=new Set;_activeScope=null;loadedExtensions=[];constructor(e){this.module=e,this.instance=null,this.exports=null}setInstance(e){this.instance=e,this.exports=e.exports}get versions(){if(this.assertNotDisposed(),!this._versions){let e={"quickjs-wasi":X,quickjs:this.readCString(this.exports.qjs_get_quickjs_version())};for(let t of this.loadedExtensions)t.versions&&Object.assign(e,t.versions);this._versions=e}return this._versions}get global(){return this._global||(this._global=new m(this,this.exports.qjs_get_global(),!0)),this._global}get undefined(){return this._undefined||(this._undefined=new m(this,this.exports.qjs_get_undefined(),!0)),this._undefined}get null(){return this._null||(this._null=new m(this,this.exports.qjs_get_null(),!0)),this._null}get true(){return this._true||(this._true=new m(this,this.exports.qjs_get_true(),!0)),this._true}get false(){return this._false||(this._false=new m(this,this.exports.qjs_get_false(),!0)),this._false}static async create(e){let t=i.normalizeOptions(e),r=await i.resolveModule(t.wasm),s=new i(r),{instance:n,wasiBuiltins:o,wasiUserOverrides:a,memoryProxy:l}=await i.instantiate(r,s,t.wasi);if(s.setInstance(n),s.exports._initialize(),(t.intrinsics!==void 0?s.exports.qjs_init2(t.intrinsics):s.exports.qjs_init())!==0)throw new Error("Failed to initialize QuickJS runtime");if(t.extensions){let c=n.exports;for(let p of t.extensions){let h=await F(p,c,o,a,l);s.loadedExtensions.push(h),V(h,c)}}return i.applyLimits(s,t),s}static async restore(e,t){let r=i.normalizeOptions(t),s=await i.resolveModule(r.wasm),n=new i(s),{instance:o,wasiBuiltins:a,wasiUserOverrides:l,memoryProxy:u}=await i.instantiate(s,n,r.wasi);n.setInstance(o);let c=o.exports,p=n.exports.memory,h=p.buffer.byteLength/65536,g=Math.ceil(e.memory.byteLength/65536);if(g>h&&p.grow(g-h),e.extensions.length>0){let w=r.extensions??[];n.loadedExtensions=await G(w,e.extensions,c,a,l,u)}return new Uint8Array(p.buffer).set(e.memory),n.exports.qjs_set_runtime_and_context(e.runtimePtr,e.contextPtr),n.exports.__stack_pointer.value=e.stackPointer,i.applyLimits(n,r),n}static serializeSnapshot(e){let t=new TextEncoder,r=4,s=[],n=[];for(let p of e.extensions){let h=t.encode(p.name),g=t.encode(p.initFn);s.push(h),n.push(g),r+=4+h.length+4+4+4+g.length}let o=D+r+e.memory.byteLength,a=new ArrayBuffer(o),l=new DataView(a),u=new Uint8Array(a);l.setUint32(0,L,!1),l.setUint8(4,B),l.setUint32(8,e.memory.byteLength,!0),l.setUint32(12,e.stackPointer,!0),l.setUint32(16,e.runtimePtr,!0),l.setUint32(20,e.contextPtr,!0);let c=D;l.setUint32(c,e.extensions.length,!0),c+=4;for(let p=0;p<e.extensions.length;p++){let h=e.extensions[p],g=s[p],d=n[p];l.setUint32(c,g.length,!0),c+=4,u.set(g,c),c+=g.length,l.setUint32(c,h.memoryBase,!0),c+=4,l.setUint32(c,h.tableBase,!0),c+=4,l.setUint32(c,d.length,!0),c+=4,u.set(d,c),c+=d.length}return u.set(e.memory,c),u}static deserializeSnapshot(e){if(e.length<D)throw new Error("Invalid snapshot: too small");let t=new DataView(e.buffer,e.byteOffset,e.byteLength),r=t.getUint32(0,!1);if(r!==L)throw new Error(`Invalid snapshot: bad magic (expected 0x${L.toString(16)}, got 0x${r.toString(16)})`);let s=t.getUint8(4);if(s!==B&&s!==1)throw new Error(`Unsupported snapshot version: ${s} (expected ${B})`);let n=t.getUint32(8,!0),o=t.getUint32(12,!0),a=t.getUint32(16,!0),l=t.getUint32(20,!0),u=[],c=D;if(s>=2){let g=t.getUint32(24,!0),d=28,w=new TextDecoder;for(let P=0;P<g;P++){let S=t.getUint32(d,!0);d+=4;let y=w.decode(e.slice(d,d+S));d+=S;let _=t.getUint32(d,!0);d+=4;let x=t.getUint32(d,!0);d+=4;let j=t.getUint32(d,!0);d+=4;let b=w.decode(e.slice(d,d+j));d+=j,u.push({name:y,memoryBase:_,tableBase:x,initFn:b})}c=d}let p=c+n;if(e.length<p)throw new Error(`Invalid snapshot: expected ${p} bytes, got ${e.length}`);return{memory:e.slice(c,c+n),stackPointer:o,runtimePtr:a,contextPtr:l,extensions:u}}static normalizeOptions(e){if(!e)return{wasm:void 0};if(e instanceof WebAssembly.Module)return{wasm:e};if(typeof e=="object"&&("wasm"in e||"wasi"in e||"memoryLimit"in e||"maxStackSize"in e||"interruptHandler"in e||"onUnhandledRejection"in e||"moduleLoader"in e||"intrinsics"in e||"extensions"in e||"timezoneOffset"in e)){let t=e;if(t.maxStackSize!==void 0&&(!Number.isInteger(t.maxStackSize)||t.maxStackSize<0||t.maxStackSize>H))throw new RangeError(`maxStackSize must be an integer between 0 and ${H}`);return t}return{wasm:e}}static applyLimits(e,t){t.memoryLimit!==void 0&&e.exports.qjs_set_memory_limit(t.memoryLimit),t.maxStackSize!==void 0&&e.exports.qjs_set_max_stack_size(t.maxStackSize),t.interruptHandler&&(e.interruptHandler=t.interruptHandler,e.exports.qjs_set_interrupt_handler(1)),t.onUnhandledRejection&&(e.unhandledRejectionHandler=t.onUnhandledRejection,e.exports.qjs_set_promise_rejection_handler(1)),t.moduleLoader&&(e.moduleLoadHandler=t.moduleLoader.load,e.moduleNormalizeHandler=t.moduleLoader.normalize??null,e.exports.qjs_set_module_loader(1));let r=t.timezoneOffset;if(typeof r=="function")e.timezoneOffsetHandler=s=>-r(s)*60;else if(typeof r=="number"){let s=-r*60;e.timezoneOffsetHandler=()=>s}else e.timezoneOffsetHandler=s=>-new Date(s*1e3).getTimezoneOffset()*60}static async resolveModule(e){if(e instanceof WebAssembly.Module)return e;if(e)return WebAssembly.compile(e);throw new TypeError("QuickJS: `wasm` option is required. Provide WASM bytes or a compiled `WebAssembly.Module`. The binary is shipped at `quickjs-wasi/quickjs.wasm` and can be loaded via your environment's preferred mechanism (e.g. `fetch()`, `node:fs/promises`, or a bundler import like Vite's `?url`).")}static async instantiate(e,t,r){let s=null,n=new Proxy({},{get(y,_){return s[_]}}),o=W(()=>s),a=r?r(n):void 0,l={...o,...a},u=(y,_,x,j,b)=>t.handleHostCall(y,_,x,j,b),c=()=>t.interruptHandler&&t.interruptHandler()?1:0,p=(y,_,x)=>{if(!t.unhandledRejectionHandler){t.exports.qjs_free_value(y),t.exports.qjs_free_value(_);return}let j=new m(t,y),b=new m(t,_);try{t.unhandledRejectionHandler(j,b,x!==0)}finally{j.dispose(),b.dispose()}},h=y=>{let _=t.newError(y instanceof Error?y:String(y));t.exports.qjs_throw(_.ptr),_.dispose()},g=(y,_)=>{if(typeof y=="string")return y;let x=y!==null&&typeof y=="object"&&typeof y.then=="function"?"a Promise":`type ${typeof y}`;throw new TypeError(`moduleLoader.${_} must synchronously return a string (got ${x}). Async module loading is not supported. Pre-fetch module sources instead (see the "ES Modules" section of the quickjs-wasi README).`)},d=(y,_)=>{if(!t.moduleNormalizeHandler){let b=t.readCString(_);return t.writeString(b).ptr}let x=t.readCString(y),j=t.readCString(_);try{let b=g(t.moduleNormalizeHandler(x,j),"normalize");return t.writeString(b).ptr}catch(b){return h(b),0}},w=(y,_)=>{if(!t.moduleLoadHandler)return 0;let x=t.readCString(y);try{let j=g(t.moduleLoadHandler(x),"load"),{ptr:b,len:k}=t.writeString(j);return new Uint32Array(t.exports.memory.buffer,_,1)[0]=k,b}catch(j){return h(j),0}},P=(y,_)=>{let x=Number(BigInt(y)<<32n|BigInt(_>>>0));return t.timezoneOffsetHandler?t.timezoneOffsetHandler(x):0},S=await WebAssembly.instantiate(e,{env:{host_call:u,host_interrupt:c,host_promise_rejection:p,host_module_normalize:d,host_module_load:w,host_get_timezone_offset:P},wasi_snapshot_preview1:l});return s=S.exports.memory,{instance:S,wasiBuiltins:o,wasiUserOverrides:a,memoryProxy:n}}handleHostCall(e,t,r,s,n){let o=this.decoder.decode(new Uint8Array(this.exports.memory.buffer,e,t)),a=this.hostCallbacks.get(o);if(!a){let c=this.newError(`Host callback "${o}" is not registered: it was unregistered, its ephemeral function handle was disposed, or it was never re-registered after a snapshot restore.`);return this.exports.qjs_throw(c.ptr),c.dispose(),0}let l=new m(this,r,!1,!0),u=[];if(s>0&&n!==0){let c=new DataView(this.exports.memory.buffer);for(let p=0;p<s;p++){let h=c.getUint32(n+p*4,!0);u.push(new m(this,h,!1,!0))}}try{let c=a.call(l,...u);return this.exports.qjs_dup_value(c.ptr)}catch(c){let p=this.newError(c instanceof Error?c:String(c));return this.exports.qjs_throw(p.ptr),p.dispose(),0}}writeString(e){let t=ae(e),r=this.exports.wasm_malloc(t.length+1);if(r===0)throw new Error("wasm_malloc failed");let s=new Uint8Array(this.exports.memory.buffer);return s.set(t,r),s[r+t.length]=0,{ptr:r,len:t.length}}readCString(e){let t=new Uint8Array(this.exports.memory.buffer),r=e;for(;t[r]!==0;)r++;return this.decoder.decode(t.slice(e,r))}throwIfException(e){if(this.exports.qjs_is_exception(e.ptr)!==0){let t=this.getException();throw e.dispose(),this._ownedHandles.add(t),new O(t)}return e}evalCode(e,t="<eval>",r=0){this.assertNotDisposed();let s=this.writeString(e),n=this.writeString(t),o=this.exports.qjs_eval(s.ptr,s.len,n.ptr,r);return this.exports.wasm_free(s.ptr),this.exports.wasm_free(n.ptr),this.throwIfException(new m(this,o))}compile(e,t="<compile>",r=0,s=0){this.assertNotDisposed();let n=this.writeString(e),o=this.writeString(t),a=this.exports.wasm_malloc(4),l=this.exports.qjs_compile(n.ptr,n.len,o.ptr,r,s,a);if(this.exports.wasm_free(n.ptr),this.exports.wasm_free(o.ptr),l===0){this.exports.wasm_free(a);let p=this.getException();throw new Error(`Compilation error: ${p.toString()}`)}let u=new Uint32Array(this.exports.memory.buffer,a,1)[0];this.exports.wasm_free(a);let c=new Uint8Array(this.exports.memory.buffer,l,u).slice();return this.exports.wasm_free(l),c}evalBytecode(e){this.assertNotDisposed();let t=this.exports.wasm_malloc(e.byteLength);new Uint8Array(this.exports.memory.buffer,t,e.byteLength).set(e);let r=this.exports.qjs_eval_bytecode(t,e.byteLength);return this.exports.wasm_free(t),this.throwIfException(new m(this,r))}executePendingJobs(){this.assertNotDisposed();let e=0;for(;this.exports.qjs_is_job_pending();){if(this.exports.qjs_execute_pending_job()<0){let r=this.getException();throw new Error(`Job execution error: ${r.toString()}`)}e++}return e}runGC(){this.assertNotDisposed(),this.exports.qjs_run_gc()}get gcThreshold(){return this.assertNotDisposed(),this.exports.qjs_get_gc_threshold()}set gcThreshold(e){this.assertNotDisposed(),this.exports.qjs_set_gc_threshold(e)}getMemoryUsage(){this.assertNotDisposed();let e=this.exports.wasm_malloc(208);this.exports.qjs_compute_memory_usage(e);let t=new BigInt64Array(this.exports.memory.buffer,e,26),r={mallocSize:Number(t[0]),mallocLimit:Number(t[1]),memoryUsedSize:Number(t[2]),mallocCount:Number(t[3]),memoryUsedCount:Number(t[4]),atomCount:Number(t[5]),atomSize:Number(t[6]),strCount:Number(t[7]),strSize:Number(t[8]),objCount:Number(t[9]),objSize:Number(t[10]),propCount:Number(t[11]),propSize:Number(t[12]),shapeCount:Number(t[13]),shapeSize:Number(t[14]),jsFuncCount:Number(t[15]),jsFuncSize:Number(t[16]),jsFuncCodeSize:Number(t[17]),jsFuncPc2lineCount:Number(t[18]),jsFuncPc2lineSize:Number(t[19]),cFuncCount:Number(t[20]),arrayCount:Number(t[21]),fastArrayCount:Number(t[22]),fastArrayElements:Number(t[23]),binaryObjectCount:Number(t[24]),binaryObjectSize:Number(t[25])};return this.exports.wasm_free(e),r}getGlobal(){return this.assertNotDisposed(),new m(this,this.exports.qjs_get_global())}newString(e){this.assertNotDisposed();let{ptr:t,len:r}=this.writeString(e),s=this.exports.qjs_new_string(t,r);return this.exports.wasm_free(t),new m(this,s)}newNumber(e){return this.assertNotDisposed(),new m(this,this.exports.qjs_new_number(e))}newBigInt(e){this.assertNotDisposed();let t=Number(e&0xffffffffn),r=Number(e>>32n&0xffffffffn);return new m(this,this.exports.qjs_new_big_int64(t,r))}newObject(){return this.assertNotDisposed(),new m(this,this.exports.qjs_new_object())}newArray(){return this.assertNotDisposed(),new m(this,this.exports.qjs_new_array())}newSymbolFor(e){this.assertNotDisposed();let{ptr:t,len:r}=this.writeString(e),s=new m(this,this.exports.qjs_new_symbol(t,r,1));return this.exports.wasm_free(t),s}newArrayBuffer(e){this.assertNotDisposed();let t=e instanceof ArrayBuffer?new Uint8Array(e):e,r=this.exports.wasm_malloc(t.length);if(r===0)throw new Error("wasm_malloc failed");new Uint8Array(this.exports.memory.buffer).set(t,r);let s=new m(this,this.exports.qjs_new_array_buffer(r,t.length));return this.exports.wasm_free(r),s}newUint8Array(e){this.assertNotDisposed();let t=this.exports.wasm_malloc(e.length);if(t===0)throw new Error("wasm_malloc failed");new Uint8Array(this.exports.memory.buffer).set(e,t);let r=new m(this,this.exports.qjs_new_uint8_array(t,e.length));return this.exports.wasm_free(t),r}getUndefined(){return this.assertNotDisposed(),new m(this,this.exports.qjs_get_undefined())}getNull(){return this.assertNotDisposed(),new m(this,this.exports.qjs_get_null())}getTrue(){return this.assertNotDisposed(),new m(this,this.exports.qjs_get_true())}getFalse(){return this.assertNotDisposed(),new m(this,this.exports.qjs_get_false())}newFunction(e,t){if(this.assertNotDisposed(),this.hostCallbacks.has(e))throw new Error(`Host callback with name "${e}" is already registered`);this.hostCallbacks.set(e,t);let{ptr:r,len:s}=this.writeString(e),n=this.exports.qjs_new_host_function(r,s,0);return this.exports.wasm_free(r),new m(this,n)}withScope(e){this.assertNotDisposed();let t=this._activeScope,r=new Set;this._activeScope=r;let s={escape:n=>(r.delete(n),t?.add(n),n)};try{return e(s)}finally{this._activeScope=t;for(let n of r)n.dispose()}}exportHandle(e){if(this.assertNotDisposed(),e.vm!==this)throw new Error("exportHandle: handle belongs to a different VM");if(e.disposed)throw new Error("exportHandle: handle is disposed");if(e._isBorrowed)throw new Error("exportHandle: cannot export a borrowed handle (host-callback this/argument); its box is freed when the callback returns. dup() it and export the duplicate.");return e.ptr}importHandle(e){if(this.assertNotDisposed(),!Number.isInteger(e)||e<=0||e>=this.exports.memory.buffer.byteLength)throw new Error(`importHandle: invalid token ${e}`);return new m(this,this.exports.qjs_dup_value(e))}newEphemeralFunction(e){this.assertNotDisposed();let t=`__ephemeral:${this.nextInternalId++}`;this.hostCallbacks.set(t,e);let{ptr:r,len:s}=this.writeString(t),n=this.exports.qjs_new_host_function(r,s,0);this.exports.wasm_free(r);let o=new m(this,n);return o._onDispose=()=>{this.hostCallbacks.delete(t)},o}unregisterHostCallback(e){return this.hostCallbacks.delete(e)}newInternalFunction(e,t){this.hostCallbacks.set(e,t);let{ptr:r,len:s}=this.writeString(e),n=this.exports.qjs_new_host_function(r,s,0);return this.exports.wasm_free(r),new m(this,n)}newPromise(){this.assertNotDisposed();let e=this.exports.wasm_malloc(4),t=this.exports.wasm_malloc(4),r=this.exports.qjs_new_promise(e,t),s=new DataView(this.exports.memory.buffer),n=s.getUint32(e,!0),o=s.getUint32(t,!0);this.exports.wasm_free(e),this.exports.wasm_free(t);let a=new m(this,r),l=new m(this,n),u=new m(this,o),c=this;c._ownedHandles.add(l),c._ownedHandles.add(u);let p=null;return{handle:a,get settled(){if(!p){let h;p=new Promise(w=>{h=w});let g=`__settle:${c.nextInternalId++}`,d=c.newInternalFunction(g,()=>(h(),c.hostCallbacks.delete(g),c.undefined));c.promiseThenRaw(a,d,d).dispose(),d.dispose()}return p},resolve(h){c.callFunctionRaw(l,c.undefined,h).dispose(),c._ownedHandles.delete(l),l.dispose()},reject(h){c.callFunctionRaw(u,c.undefined,h).dispose(),c._ownedHandles.delete(u),u.dispose()}}}resolvePromise(e){if(this.assertNotDisposed(),!this.exports.qjs_is_promise(e.ptr))return Promise.resolve({value:e.dup()});let t=this.exports.qjs_promise_state(e.ptr);return t===1?Promise.resolve({value:new m(this,this.exports.qjs_promise_result(e.ptr))}):t===2?Promise.resolve({error:new m(this,this.exports.qjs_promise_result(e.ptr))}):new Promise(r=>{let s=this.nextInternalId++,n=`__onFulfilled:${s}`,o=`__onRejected:${s}`,a=this.newInternalFunction(n,(...u)=>{let c=u[0]?.dup()??this.undefined;return this.hostCallbacks.delete(n),this.hostCallbacks.delete(o),r({value:c}),this.undefined}),l=this.newInternalFunction(o,(...u)=>{let c=u[0]?.dup()??this.undefined;return this.hostCallbacks.delete(n),this.hostCallbacks.delete(o),r({error:c}),this.undefined});this.promiseThenRaw(e,a,l).dispose(),a.dispose(),l.dispose()})}promiseThenRaw(e,t,r){return new m(this,this.exports.qjs_promise_then(e.ptr,t.ptr,r.ptr))}markPromiseHandled(e){this.assertNotDisposed(),this.exports.qjs_promise_mark_as_handled(e.ptr)}callFunction(e,t,...r){return this.throwIfException(this.callFunctionRaw(e,t,...r))}construct(e,...t){this.assertNotDisposed();let r=t.length,s=0;if(r>0){s=this.exports.wasm_malloc(r*4);let o=new DataView(this.exports.memory.buffer);for(let a=0;a<r;a++)o.setUint32(s+a*4,t[a].ptr,!0)}let n=this.exports.qjs_call_constructor(e.ptr,r,s);return s&&this.exports.wasm_free(s),this.throwIfException(new m(this,n))}callFunctionRaw(e,t,...r){this.assertNotDisposed();let s=r.length,n=0;if(s>0){n=this.exports.wasm_malloc(s*4);let a=new DataView(this.exports.memory.buffer);for(let l=0;l<s;l++)a.setUint32(n+l*4,r[l].ptr,!0)}let o=this.exports.qjs_call(e.ptr,t.ptr,s,n);return n&&this.exports.wasm_free(n),new m(this,o)}setProp(e,t,r){if(this.assertNotDisposed(),typeof t=="string"){let{ptr:s}=this.writeString(t);this.exports.qjs_set_prop_string(e.ptr,s,r.ptr),this.exports.wasm_free(s)}else this.exports.qjs_set_prop_value(e.ptr,t.ptr,r.ptr)}defineProp(e,t,r,s){this.assertNotDisposed();let n=0;if(s?.configurable&&(n|=1),s?.writable&&(n|=2),s?.enumerable&&(n|=4),typeof t=="string"){let{ptr:o}=this.writeString(t);this.exports.qjs_define_prop_string(e.ptr,o,r.ptr,n),this.exports.wasm_free(o)}else this.exports.qjs_define_prop_value(e.ptr,t.ptr,r.ptr,n)}getProp(e,t){return this.assertNotDisposed(),new m(this,this.exports.qjs_get_prop_value(e.ptr,t.ptr))}getException(){return this.assertNotDisposed(),new m(this,this.exports.qjs_get_exception())}newError(e){this.assertNotDisposed();let t=this.exports.qjs_new_error(),r=new m(this,t);if(typeof e=="string"){let s=this.newString(e);r.setProp("message",s),s.dispose()}else{let s=this.newString(e.message);if(r.setProp("message",s),s.dispose(),e.name){let n=this.newString(e.name);r.setProp("name",n),n.dispose()}if(e.stack){let n=this.newString(e.stack);r.setProp("stack",n),n.dispose()}}return r}typeof(e){this.assertNotDisposed();let t=this.exports;return t.qjs_is_undefined(e.ptr)?"undefined":t.qjs_is_null(e.ptr)?"object":t.qjs_is_bool(e.ptr)?"boolean":t.qjs_is_number(e.ptr)?"number":t.qjs_is_big_int(e.ptr)?"bigint":t.qjs_is_string(e.ptr)?"string":t.qjs_is_symbol(e.ptr)?"symbol":t.qjs_is_function(e.ptr)?"function":t.qjs_is_object(e.ptr)?"object":"unknown"}dump(e){return this.assertNotDisposed(),this._dump(e,new Map)}_dump(e,t){let r=this.exports;if(!r.qjs_is_undefined(e.ptr)){if(r.qjs_is_null(e.ptr))return null;if(r.qjs_is_bool(e.ptr))return r.qjs_get_bool(e.ptr)!==0;if(r.qjs_is_number(e.ptr))return r.qjs_get_float64(e.ptr);if(r.qjs_is_string(e.ptr))return e.toString();if(r.qjs_is_big_int(e.ptr))return e.toBigInt();if(r.qjs_is_symbol(e.ptr)){let s=r.wasm_malloc(4),n=r.qjs_get_symbol_description(e.ptr,s),a=new DataView(r.memory.buffer).getUint32(s,!0);if(r.wasm_free(s),n===1){let l=new m(this,a),u=l.toString();return l.dispose(),Symbol.for(u)}else if(n===2){new m(this,a).dispose();return}return}if(r.qjs_is_array_buffer(e.ptr))return e.toArrayBuffer();if(r.qjs_is_exception(e.ptr)){let s=this.getException(),n=s.toString();return s.dispose(),new Error(n)}if(!r.qjs_is_function(e.ptr)){if(r.qjs_is_object(e.ptr)){let s=r.qjs_get_value_ptr(e.ptr);if(s){let n=t.get(s);if(n!==void 0)return n}}if(r.qjs_is_object(e.ptr)){let s=r.wasm_malloc(4),n=r.wasm_malloc(4),o=r.wasm_malloc(4),a=r.qjs_get_typed_array_buffer(e.ptr,s,n,o),l=new m(this,a);if(r.qjs_is_exception(l.ptr)===0){let u=new DataView(r.memory.buffer),c=u.getUint32(s,!0),p=u.getUint32(n,!0),h=u.getUint32(o,!0);r.wasm_free(s),r.wasm_free(n),r.wasm_free(o);let g=r.wasm_malloc(4),d=r.qjs_get_array_buffer(l.ptr,g);if(r.wasm_free(g),l.dispose(),d!==0){let w=new Uint8Array(r.memory.buffer,d+c,p).slice();switch(h){case 1:return w;case 2:return new Uint16Array(w.buffer);case 4:return new Uint32Array(w.buffer);case 8:return new Float64Array(w.buffer);default:return w}}}else l.dispose(),r.wasm_free(s),r.wasm_free(n),r.wasm_free(o)}if(r.qjs_is_array(e.ptr)){let s=e.getProp("length"),n=r.qjs_get_float64(s.ptr);s.dispose();let o=[],a=r.qjs_get_value_ptr(e.ptr);a&&t.set(a,o);for(let l=0;l<n;l++){let u=r.qjs_get_prop_uint32(e.ptr,l),c=new m(this,u);o.push(this._dump(c,t)),c.dispose()}return o}if(r.qjs_is_error(e.ptr)){let s=e.getProp("name"),n=e.getProp("message"),o=e.getProp("stack"),a=s.isUndefined?"Error":s.toString(),l=n.isUndefined?"":n.toString(),u=o.isUndefined?void 0:o.toString();s.dispose(),n.dispose(),o.dispose();let c=new Error(l);return c.name=a,u!==void 0&&(c.stack=u),c}if(r.qjs_is_object(e.ptr)){let s=r.qjs_get_own_property_names(e.ptr),n=new m(this,s);if(r.qjs_is_exception(n.ptr)!==0)return n.dispose(),{};let o=n.getProp("length"),a=r.qjs_get_float64(o.ptr);o.dispose();let l={},u=r.qjs_get_value_ptr(e.ptr);u&&t.set(u,l);for(let c=0;c<a;c++){let p=r.qjs_get_prop_uint32(n.ptr,c),h=new m(this,p),g=h.toString();h.dispose();let d=e.getProp(g);l[g]=this._dump(d,t),d.dispose()}return n.dispose(),l}}}}hostToHandle(e){if(this.assertNotDisposed(),e===void 0)return this.undefined;if(e===null)return this.null;if(e===!0)return this.true;if(e===!1)return this.false;if(typeof e=="number")return this.newNumber(e);if(typeof e=="string")return this.newString(e);if(typeof e=="bigint")return this.newBigInt(e);if(typeof e=="symbol"){let t=Symbol.keyFor(e);if(t!==void 0)return this.newSymbolFor(t);throw new Error("Cannot convert local symbol to QuickJS handle. Use Symbol.for() for cross-boundary symbols.")}if(e instanceof Promise){let t=this.newPromise();return e.then(r=>{t.resolve(this.hostToHandle(r)),this.executePendingJobs()},r=>{t.reject(this.hostToHandle(r)),this.executePendingJobs()}),t.handle}if(e instanceof Error)return this.newError(e);if(e instanceof ArrayBuffer)return this.newArrayBuffer(e);if(e instanceof Uint8Array)return this.newUint8Array(e);if(ArrayBuffer.isView(e))return this.newArrayBuffer(new Uint8Array(e.buffer,e.byteOffset,e.byteLength));if(Array.isArray(e)){let t=this.newArray();for(let r=0;r<e.length;r++){let s=this.hostToHandle(e[r]);this.exports.qjs_set_prop_uint32(t.ptr,r,s.ptr),s.dispose()}return t}if(typeof e=="object"&&e!==null){let t=this.newObject();for(let[r,s]of Object.entries(e)){let n=this.hostToHandle(s);t.setProp(r,n),n.dispose()}return t}return this.undefined}snapshot(){return this.assertNotDisposed(),{memory:new Uint8Array(this.exports.memory.buffer).slice(),stackPointer:this.exports.__stack_pointer.value,runtimePtr:this.exports.qjs_get_runtime_ptr(),contextPtr:this.exports.qjs_get_context_ptr(),extensions:this.loadedExtensions.map(e=>({name:e.name,memoryBase:e.memoryBase,tableBase:e.tableBase,initFn:e.initFn}))}}registerHostCallback(e,t){this.hostCallbacks.set(e,t)}dispose(){this.disposed||(this.disposed=!0,this._global=null,this._undefined=null,this._null=null,this._true=null,this._false=null,this._ownedHandles.clear(),this.hostCallbacks.clear(),this._activeScope=null,this.exports=null,this.instance=null,this.module=null)}[Symbol.dispose](){this.dispose()}assertNotDisposed(){if(this.disposed)throw new Error("QuickJS instance has been disposed")}_getExports(){return this.exports}_getMemory(){return this.exports.memory}_writeString(e){return this.writeString(e)}_readCString(e){return this.readCString(e)}};function C(i){return i.includes("\0")||K.test(i)}var oe=new TextDecoder,ie=new TextEncoder,K=/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/;function ae(i){if(!K.test(i))return ie.encode(i);let e=[];for(let t=0;t<i.length;t++){let r=i.charCodeAt(t);if(r<128)e.push(r);else if(r<2048)e.push(192|r>>6,128|r&63);else if(r>=55296&&r<=56319&&t+1<i.length){let s=i.charCodeAt(t+1);if(s>=56320&&s<=57343){let n=65536+(r-55296<<10)+(s-56320);e.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|n&63),t++;continue}e.push(224|r>>12,128|r>>6&63,128|r&63)}else e.push(224|r>>12,128|r>>6&63,128|r&63)}return new Uint8Array(e)}function le(i){let e=!1;for(let s=0;s<i.length-1;s++)if(i[s]===237&&i[s+1]>=160&&i[s+1]<=191){e=!0;break}if(!e)return oe.decode(i);let t="",r=0;for(;r<i.length;){let s=i[r];if(s<128)t+=String.fromCharCode(s),r+=1;else if(s<224)t+=String.fromCharCode((s&31)<<6|i[r+1]&63),r+=2;else if(s<240)t+=String.fromCharCode((s&15)<<12|(i[r+1]&63)<<6|i[r+2]&63),r+=3;else{let n=(s&7)<<18|(i[r+1]&63)<<12|(i[r+2]&63)<<6|i[r+3]&63;t+=String.fromCodePoint(n),r+=4}}return t}var O=class extends Error{handle;#e;#t;#r;constructor(e){let t={stack:[],error:void 0,hasError:!1};try{super(),this.handle=e,delete this.stack;let r=A(t,e.getProp("message"),!1);this.#e=e.getProp("name").consume(s=>s.isUndefined?"Error":s.toString()),this.#t=r.isUndefined?e.toString():r.toString(),this.#r=e.getProp("stack").consume(s=>s.isUndefined?void 0:s.toString())}catch(r){t.error=r,t.hasError=!0}finally{T(t)}}get name(){return this.#e}set name(e){this.#e=e}get message(){return this.#t}set message(e){this.#t=e}get stack(){return this.#r}set stack(e){this.#r=e}dispose(){this.handle.dispose()}[Symbol.dispose](){this.handle.dispose()}},m=class i{vm;ptr;disposed_=!1;singleton;borrowed;_onDispose;constructor(e,t,r=!1,s=!1){this.vm=e,this.ptr=t,this.singleton=r,this.borrowed=s,!r&&!s&&e._activeScope?.add(this)}get _isBorrowed(){return this.borrowed}get disposed(){return this.disposed_}get isUndefined(){return this.vm._getExports().qjs_is_undefined(this.ptr)!==0}get isNull(){return this.vm._getExports().qjs_is_null(this.ptr)!==0}get isBool(){return this.vm._getExports().qjs_is_bool(this.ptr)!==0}get isNumber(){return this.vm._getExports().qjs_is_number(this.ptr)!==0}get isString(){return this.vm._getExports().qjs_is_string(this.ptr)!==0}get isSymbol(){return this.vm._getExports().qjs_is_symbol(this.ptr)!==0}get isBigInt(){return this.vm._getExports().qjs_is_big_int(this.ptr)!==0}get isObject(){return this.vm._getExports().qjs_is_object(this.ptr)!==0}get isArray(){return this.vm._getExports().qjs_is_array(this.ptr)!==0}get isFunction(){return this.vm._getExports().qjs_is_function(this.ptr)!==0}get isError(){return this.vm._getExports().qjs_is_error(this.ptr)!==0}get isPromise(){return this.vm._getExports().qjs_is_promise(this.ptr)!==0}get isArrayBuffer(){return this.vm._getExports().qjs_is_array_buffer(this.ptr)!==0}get isProxy(){return this.vm._getExports().qjs_is_proxy(this.ptr)!==0}get isMap(){return this.vm._getExports().qjs_is_map(this.ptr)!==0}get isSet(){return this.vm._getExports().qjs_is_set(this.ptr)!==0}get isDate(){return this.vm._getExports().qjs_is_date(this.ptr)!==0}get isRegExp(){return this.vm._getExports().qjs_is_regexp(this.ptr)!==0}get isWeakRef(){return this.vm._getExports().qjs_is_weak_ref(this.ptr)!==0}get isWeakMap(){return this.vm._getExports().qjs_is_weak_map(this.ptr)!==0}get isWeakSet(){return this.vm._getExports().qjs_is_weak_set(this.ptr)!==0}get isDataView(){return this.vm._getExports().qjs_is_data_view(this.ptr)!==0}get identity(){return this.vm._getExports().qjs_get_value_ptr(this.ptr)}toBoolean(){return this.vm._getExports().qjs_get_bool(this.ptr)!==0}get classId(){return this.vm._getExports().qjs_get_class_id(this.ptr)}get className(){let e=new i(this.vm,this.vm._getExports().qjs_get_class_name(this.ptr));if(this.vm._getExports().qjs_is_exception(e.ptr)!==0)throw e.dispose(),new O(this.vm.getException());try{return e.isUndefined?void 0:e.toString()}finally{e.dispose()}}get promiseState(){return this.vm._getExports().qjs_promise_state(this.ptr)}get typeof(){return this.vm.typeof(this)}get length(){let e=this.getProp("length"),t=e.toNumber();return e.dispose(),t}get constructorName(){let e=this.getProp("constructor");if(e.isUndefined||e.isNull){e.dispose();return}let t=e.getProp("name");if(e.dispose(),t.isUndefined||t.isNull){t.dispose();return}let r=t.toString();return t.dispose(),r}keys(){let e=this.vm._getExports(),t=e.qjs_get_own_property_names(this.ptr),r=new i(this.vm,t);if(e.qjs_is_exception(r.ptr)!==0)return r.dispose(),[];let s=r.getProp("length"),n=e.qjs_get_float64(s.ptr);s.dispose();let o=[];for(let a=0;a<n;a++){let l=e.qjs_get_prop_uint32(r.ptr,a),u=new i(this.vm,l);o.push(u.toString()),u.dispose()}return r.dispose(),o}getOwnPropertyNames(){let e=this.vm._getExports(),t=e.qjs_get_own_property_names_all(this.ptr),r=new i(this.vm,t);if(e.qjs_is_exception(r.ptr)!==0)return r.dispose(),[];let s=r.getProp("length"),n=e.qjs_get_float64(s.ptr);s.dispose();let o=[];for(let a=0;a<n;a++){let l=e.qjs_get_prop_uint32(r.ptr,a),u=new i(this.vm,l);o.push(u.toString()),u.dispose()}return r.dispose(),o}getOwnPropertyKeys(){let e=this.vm._getExports(),t=e.qjs_get_own_property_keys(this.ptr),r=new i(this.vm,t);if(e.qjs_is_exception(r.ptr)!==0)return r.dispose(),[];let s=r.getProp("length"),n=e.qjs_get_float64(s.ptr);s.dispose();let o=[];for(let a=0;a<n;a++){let l=e.qjs_get_prop_uint32(r.ptr,a),u=new i(this.vm,l);u.isSymbol?o.push(u):(o.push(u.toString()),u.dispose())}return r.dispose(),o}getOwnPropertyDescriptor(e){let t={stack:[],error:void 0,hasError:!1};try{let r=this.vm._getExports(),s,n;typeof e=="string"?(s=this.vm.newString(e),n=s.ptr):n=e.ptr;let o=r.qjs_get_own_property_descriptor(this.ptr,n);if(s?.dispose(),o===0)return;let a=A(t,new i(this.vm,o),!1);if(r.qjs_is_exception(a.ptr)!==0)throw new O(this.vm.getException());let l=a.getProp("enumerable").consume(c=>r.qjs_get_bool(c.ptr)!==0),u=a.getProp("configurable").consume(c=>r.qjs_get_bool(c.ptr)!==0);return a.hasOwnProperty("value")?{value:a.getProp("value"),writable:a.getProp("writable").consume(c=>r.qjs_get_bool(c.ptr)!==0),enumerable:l,configurable:u}:{get:a.getProp("get"),set:a.getProp("set"),enumerable:l,configurable:u}}catch(r){t.error=r,t.hasError=!0}finally{T(t)}}hasOwnProperty(e){if(C(e)){let s={stack:[],error:void 0,hasError:!1};try{let n=A(s,this.vm.newString(e),!1);return this.vm._getExports().qjs_has_own_property_value(this.ptr,n.ptr)===1}catch(n){s.error=n,s.hasError=!0}finally{T(s)}}let{ptr:t}=this.vm._writeString(e),r=this.vm._getExports().qjs_has_own_property(this.ptr,t);return this.vm._getExports().wasm_free(t),r===1}propertyIsEnumerable(e){if(C(e)){let s={stack:[],error:void 0,hasError:!1};try{let n=A(s,this.vm.newString(e),!1);return this.vm._getExports().qjs_property_is_enumerable_value(this.ptr,n.ptr)===1}catch(n){s.error=n,s.hasError=!0}finally{T(s)}}let{ptr:t}=this.vm._writeString(e),r=this.vm._getExports().qjs_property_is_enumerable(this.ptr,t);return this.vm._getExports().wasm_free(t),r===1}getPrototypeOf(){let e=this.vm._getExports().qjs_get_prototype_of(this.ptr);return new i(this.vm,e)}getProxyTarget(){let e=this.vm._getExports().qjs_get_proxy_target(this.ptr),t=new i(this.vm,e);if(this.vm._getExports().qjs_is_exception(t.ptr)!==0)throw t.dispose(),new O(this.vm.getException());return t}getProxyHandler(){let e=this.vm._getExports().qjs_get_proxy_handler(this.ptr),t=new i(this.vm,e);if(this.vm._getExports().qjs_is_exception(t.ptr)!==0)throw t.dispose(),new O(this.vm.getException());return t}getProp(e){if(C(e)){let s={stack:[],error:void 0,hasError:!1};try{let n=A(s,this.vm.newString(e),!1);return this.vm.getProp(this,n)}catch(n){s.error=n,s.hasError=!0}finally{T(s)}}let{ptr:t}=this.vm._writeString(e),r=this.vm._getExports().qjs_get_prop_string(this.ptr,t);return this.vm._getExports().wasm_free(t),new i(this.vm,r)}setProp(e,t){if(C(e)){let s={stack:[],error:void 0,hasError:!1};try{let n=A(s,this.vm.newString(e),!1);this.vm.setProp(this,n,t);return}catch(n){s.error=n,s.hasError=!0}finally{T(s)}}let{ptr:r}=this.vm._writeString(e);this.vm._getExports().qjs_set_prop_string(this.ptr,r,t.ptr),this.vm._getExports().wasm_free(r)}defineProp(e,t,r){let s=0;if(r?.configurable&&(s|=1),r?.writable&&(s|=2),r?.enumerable&&(s|=4),typeof e=="string"){if(C(e)){let o={stack:[],error:void 0,hasError:!1};try{let a=A(o,this.vm.newString(e),!1);this.vm._getExports().qjs_define_prop_value(this.ptr,a.ptr,t.ptr,s);return}catch(a){o.error=a,o.hasError=!0}finally{T(o)}}let{ptr:n}=this.vm._writeString(e);this.vm._getExports().qjs_define_prop_string(this.ptr,n,t.ptr,s),this.vm._getExports().wasm_free(n)}else this.vm._getExports().qjs_define_prop_value(this.ptr,e.ptr,t.ptr,s)}toNumber(){return this.vm._getExports().qjs_get_float64(this.ptr)}toBigInt(){let e=this.vm._getExports(),t=e.wasm_malloc(4),r=e.wasm_malloc(4);if(e.qjs_get_big_int64(this.ptr,t,r)!==0)throw e.wasm_free(t),e.wasm_free(r),new Error("Failed to convert value to BigInt");let n=new DataView(e.memory.buffer),o=n.getUint32(t,!0),a=n.getInt32(r,!0);return e.wasm_free(t),e.wasm_free(r),BigInt(a)<<32n|BigInt(o)}toArrayBuffer(){let e=this.vm._getExports(),t=e.wasm_malloc(4);if(e.qjs_is_array_buffer(this.ptr)){let g=e.qjs_get_array_buffer(this.ptr,t);if(g===0)throw e.wasm_free(t),new Error("Failed to get ArrayBuffer data");let w=new DataView(e.memory.buffer).getUint32(t,!0);return e.wasm_free(t),new Uint8Array(e.memory.buffer,g,w).slice().buffer}e.wasm_free(t);let r=e.wasm_malloc(4),s=e.wasm_malloc(4),n=e.wasm_malloc(4),o=e.qjs_get_typed_array_buffer(this.ptr,r,s,n),a=new i(this.vm,o);if(this.vm._getExports().qjs_is_exception(a.ptr)!==0)throw a.dispose(),e.wasm_free(r),e.wasm_free(s),e.wasm_free(n),new Error("Value is not an ArrayBuffer or typed array");let l=new DataView(e.memory.buffer),u=l.getUint32(r,!0),c=l.getUint32(s,!0);e.wasm_free(r),e.wasm_free(s),e.wasm_free(n);let p=e.wasm_malloc(4),h=e.qjs_get_array_buffer(a.ptr,p);if(e.wasm_free(p),a.dispose(),h===0)throw new Error("Failed to get ArrayBuffer data from typed array");return new Uint8Array(e.memory.buffer,h+u,c).slice().buffer}toUint8Array(){return new Uint8Array(this.toArrayBuffer())}toString(){let e=this.vm._getExports(),t=e.wasm_malloc(4);if(t===0)throw new Error("wasm_malloc failed");try{let r=e.qjs_get_string_len(this.ptr,t);if(r===0)return"<null>";let s=new DataView(e.memory.buffer).getUint32(t,!0),n=new Uint8Array(e.memory.buffer,r,s),o=le(n);return e.qjs_free_cstring(r),o}finally{e.wasm_free(t)}}consume(e){try{return e(this)}finally{this.dispose()}}dup(){return new i(this.vm,this.vm._getExports().qjs_dup_value(this.ptr))}dispose(){if(!(this.singleton||this.borrowed)&&!this.disposed_){this.disposed_=!0,this._onDispose?.(),this._onDispose=void 0;let e=this.vm._getExports();e&&e.qjs_free_value(this.ptr)}}[Symbol.dispose](){this.dispose()}};var z='image expects a non-empty image URL string, an object with image_url, or an image block { type: "image", data, mimeType }',$=`(function (bridge, toolsJson, globalsJson, storeJson) {
	"use strict";

	// Freeze every object reachable from the built-in globals, plus the intrinsics that are only
	// reachable from instances (iterator and generator prototypes, %TypedArray%).
	//
	// Freezing alone breaks ordinary code through the "override mistake": a data property that is
	// read-only on a prototype cannot be assigned on an instance either, so
	// this.name = "MyError" in an Error subclass would throw. Commonly overridden properties
	// become accessors whose setter defines an own property on the instance instead.
	(function lockdown() {
		const OVERRIDABLE = new Set(["constructor", "name", "message", "toString", "toLocaleString", "valueOf", "toJSON"]);
		const seen = new Set([globalThis]);
		const queue = [];
		const add = (value) => {
			if ((typeof value === "object" && value !== null) || typeof value === "function") {
				if (!seen.has(value)) {
					seen.add(value);
					queue.push(value);
				}
			}
		};

		// Accessors from an object literal have no own prototype object, unlike function expressions,
		// whose prototype.constructor would be converted again without end.
		function allowOverride(object, key, value, enumerable) {
			const { get, set } = Object.getOwnPropertyDescriptor(
				{
					get accessor() {
						return value;
					},
					set accessor(next) {
						if (this === object) {
							throw new TypeError("Cannot assign to read only property '" + String(key) + "' of a built-in");
						}
						if ((typeof this !== "object" || this === null) && typeof this !== "function") return;
						Object.defineProperty(this, key, { value: next, writable: true, enumerable: true, configurable: true });
					},
				},
				"accessor",
			);
			Object.defineProperty(object, key, { get, set, enumerable, configurable: false });
			add(get);
			add(set);
		}

		for (const key of Reflect.ownKeys(globalThis)) {
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
			add(descriptor.value);
			add(descriptor.get);
			add(descriptor.set);
			if ("value" in descriptor && descriptor.configurable) {
				Object.defineProperty(globalThis, key, { writable: false, configurable: false });
			}
		}
		add(Object.getPrototypeOf(function* () {}));
		add(Object.getPrototypeOf(async function () {}));
		add(Object.getPrototypeOf(async function* () {}));
		add(Object.getPrototypeOf(Int8Array));
		add(Object.getPrototypeOf([][Symbol.iterator]()));
		add(Object.getPrototypeOf(new Map()[Symbol.iterator]()));
		add(Object.getPrototypeOf(new Set()[Symbol.iterator]()));
		add(Object.getPrototypeOf(""[Symbol.iterator]()));
		add(Object.getPrototypeOf(/a/[Symbol.matchAll]("")));
		if (typeof Iterator === "function") {
			if (typeof Iterator.prototype.map === "function") add(Object.getPrototypeOf([].values().map((x) => x)));
			if (typeof Iterator.from === "function") add(Object.getPrototypeOf(Iterator.from({ next() {} })));
		}

		while (queue.length > 0) {
			const object = queue.pop();
			add(Object.getPrototypeOf(object));
			const descriptors = Object.getOwnPropertyDescriptors(object);
			for (const key of Reflect.ownKeys(descriptors)) {
				const descriptor = descriptors[key];
				if ("value" in descriptor) {
					add(descriptor.value);
					if (
						descriptor.writable &&
						descriptor.configurable &&
						(object === Object.prototype || OVERRIDABLE.has(key))
					) {
						allowOverride(object, key, descriptor.value, descriptor.enumerable);
					}
				} else {
					add(descriptor.get);
					add(descriptor.set);
				}
			}
			Object.freeze(object);
		}
	})();
	const stringify = JSON.stringify;
	const parse = JSON.parse;
	const promiseThen = Promise.prototype.then;
	const ErrorCtor = Error;
	const TypeErrorCtor = TypeError;
	const RangeErrorCtor = RangeError;
	const pending = new Map();
	let nextId = 1;
	let finished = false;
	// Thrown by exit() to unwind the script after it already reported success.
	const EXIT = Object.freeze({});

	function done(ok, payload, writes) {
		if (finished) return;
		finished = true;
		bridge("done", ok, payload, writes);
	}

	function serialize(value) {
		return value === undefined ? undefined : stringify(value);
	}

	// QuickJS stacks list frames only. Prefix "Name: message" like V8 so the
	// text reads the same as a Node error, and drop this prelude's frames.
	function errorText(error) {
		const head = error.message ? error.name + ": " + error.message : String(error.name);
		const frames =
			typeof error.stack === "string"
				? error.stack.split("\\n").filter((line) => line.trim() && !line.includes("codemode-prelude.js"))
				: [];
		return [head, ...frames].join("\\n");
	}

	function format(value) {
		if (typeof value === "string") return value;
		if (value instanceof ErrorCtor) return errorText(value);
		// JSON.stringify turns NaN and Infinity into "null".
		if (typeof value === "number") return String(value);
		try {
			const json = stringify(value);
			return json === undefined ? String(value) : json;
		} catch {
			return String(value);
		}
	}

	// The host requires string fields. A script can set an error's name or message to anything, so
	// they are coerced, and a value whose coercion throws gets a placeholder.
	function describeError(error) {
		try {
			if (error instanceof ErrorCtor) {
				return stringify({ name: String(error.name), message: String(error.message), stack: errorText(error) });
			}
			return stringify({ message: String(format(error)) });
		} catch {
			return stringify({ message: "The script threw a value that cannot be described" });
		}
	}

	function caller(kind, name, spread) {
		return (...args) =>
			new Promise((resolve, reject) => {
				let json;
				try {
					json = serialize(spread ? args : args[0]);
				} catch (error) {
					reject(error);
					return;
				}
				const id = nextId++;
				pending.set(id, { resolve, reject });
				bridge(kind, id, name, json);
			});
	}

	const tools = Object.create(null);
	const allTools = [];
	for (const { name, jsName, description } of parse(toolsJson)) {
		const fn = caller("call", name);
		// The first tool wins when two names normalize to the same identifier.
		if (!(jsName in tools)) {
			tools[jsName] = fn;
			allTools.push(Object.freeze({ name: jsName, description }));
		}
		if (!(name in tools)) tools[name] = fn;
	}
	Object.freeze(tools);
	Object.freeze(allTools);

	// Reading a member that does not exist throws an error that names the close matches, instead of
	// a later "not a function". \`in\` checks still work.
	const comparable = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
	function guard(target, label, names, hint) {
		return new Proxy(target, {
			get(object, property, receiver) {
				if (typeof property !== "string" || property in object || property in Object.prototype || property === "then" || property === "toJSON") {
					return Reflect.get(object, property, receiver);
				}
				const wanted = comparable(property);
				const exact = names.filter((name) => comparable(name) === wanted);
				const close = exact.length > 0 ? exact : names.filter((name) => wanted && (comparable(name).includes(wanted) || wanted.includes(comparable(name))));
				let message = label + "." + property + " does not exist.";
				if (close.length > 0) message += " Did you mean " + close.slice(0, 5).map((name) => label + "." + name).join(", ") + "?";
				else if (names.length <= 20) message += " Available: " + names.join(", ") + ".";
				if (hint) message += " " + hint;
				message += ' Check for a member with "' + property + '" in ' + label + ".";
				throw new TypeErrorCtor(message);
			},
		});
	}
	const toolsProxy = guard(
		tools,
		"tools",
		allTools.map((tool) => tool.name),
		"ALL_TOOLS lists every tool; searchTools(query) finds tools by topic.",
	);

	const namespaces = new Map();
	for (const { name, spread } of parse(globalsJson)) {
		const fn = caller("global", name, spread);
		const dot = name.indexOf(".");
		if (dot === -1) {
			Object.defineProperty(globalThis, name, { value: fn, enumerable: true });
			continue;
		}
		const namespace = name.slice(0, dot);
		if (!namespaces.has(namespace)) namespaces.set(namespace, Object.create(null));
		namespaces.get(namespace)[name.slice(dot + 1)] = fn;
	}
	for (const [namespace, members] of namespaces) {
		Object.freeze(members);
		const value = guard(members, namespace, Object.keys(members));
		Object.defineProperty(globalThis, namespace, { value, enumerable: true });
	}

	// key -> JSON text. Sizes count key and JSON characters.
	const stored = new Map(Object.entries(parse(storeJson)));
	const writes = new Map();
	let storedChars = 0;
	for (const [key, json] of stored) storedChars += key.length + json.length;

	const STORE_HINT =
		"store() is for small state such as IDs or summaries. Show images with image(), keep large data in variables, or write it to a file with a tool.";

	function checkKey(name, key) {
		if (typeof key !== "string") throw new TypeError(name + "() key must be a string");
	}

	function store(key, value) {
		checkKey("store", key);
		const previous = stored.has(key) ? key.length + stored.get(key).length : 0;
		if (value === undefined) {
			stored.delete(key);
			storedChars -= previous;
			writes.set(key, undefined);
			return;
		}
		let json;
		try {
			json = stringify(value);
		} catch (error) {
			throw new TypeError("store(" + stringify(key) + ") value is not JSON-serializable: " + format(error));
		}
		if (json === undefined) {
			throw new TypeError("store(" + stringify(key) + ") value is not JSON-serializable");
		}
		if (json.length > 262144) {
			throw new RangeError(
				"store(" + stringify(key) + ") value has " + json.length + " characters of JSON, more than the limit of 262144. " +
					STORE_HINT,
			);
		}
		const next = storedChars - previous + key.length + json.length;
		if (next > 1048576) {
			throw new RangeError(
				"store is full: stored values would exceed 1048576 characters of JSON. Delete keys with store(key, undefined). " +
					STORE_HINT,
			);
		}
		stored.set(key, json);
		storedChars = next;
		writes.set(key, json);
	}

	function load(key) {
		checkKey("load", key);
		const json = stored.get(key);
		return json === undefined ? undefined : parse(json);
	}

	function serializeWrites() {
		const entries = [];
		for (const [key, json] of writes) entries.push(json === undefined ? [key] : [key, json]);
		return stringify(entries);
	}

	Object.defineProperty(globalThis, "store", { value: store, enumerable: true });
	Object.defineProperty(globalThis, "load", { value: load, enumerable: true });

	let outputChars = 0;
	let outputItems = 0;

	// Past the output limits the script fails: done() reports the error, so catching it does not
	// resume output, and the host ends the script.
	function output(kind, data, mimeType) {
		if (finished) return;
		outputChars += data.length;
		outputItems++;
		if (outputChars > 16777216 || outputItems > 100000) {
			const error = new RangeErrorCtor(
				"script output exceeded the limit of 16777216 characters or 100000 text(), image(), and console calls. " +
					"Print a summary instead, or write large data to a file with a tool.",
			);
			done(false, describeError(error));
			throw error;
		}
		bridge("output", kind, data, mimeType);
	}

	// Primitives become their string form, everything else JSON.
	function outputText(value) {
		if (value === undefined || value === null || typeof value !== "object" && typeof value !== "function") {
			return String(value);
		}
		const json = stringify(value);
		return json === undefined ? String(value) : json;
	}

	function text(value) {
		let rendered;
		try {
			rendered = outputText(value);
		} catch (error) {
			throw new TypeErrorCtor(error instanceof ErrorCtor ? error.message : String(error));
		}
		output("text", rendered);
	}

	function imageUrl(value) {
		if (typeof value === "string") return value;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new TypeErrorCtor(${JSON.stringify(z)});
		}
		if (value.image_url !== undefined) {
			if (typeof value.image_url !== "string") throw new TypeErrorCtor(${JSON.stringify(z)});
			return value.image_url;
		}
		if (typeof value.type !== "string") throw new TypeErrorCtor(${JSON.stringify(z)});
		if (value.type !== "image") {
			throw new TypeErrorCtor('image only accepts image blocks, got "' + value.type + '"');
		}
		if (typeof value.data !== "string" || value.data === "") throw new TypeErrorCtor("image expected image block data");
		if (value.data.toLowerCase().startsWith("data:")) return value.data;
		return "data:;base64," + value.data;
	}

	// Base64 of the signatures of the formats providers accept inline (PNG, JPEG except
	// JPEG-LS, GIF, "RIFF....WEBP"). Signatures start at byte 0, so their encodings are prefixes.
	const IMAGE_SIGNATURES = [
		["image/png", /^iVBORw0KGg/],
		["image/jpeg", /^[/]9j[/](?!9)/],
		["image/gif", /^R0lGOD[dl]h/],
		["image/webp", /^UklG.{8}RUJQ/],
	];

	function image(value) {
		const url = imageUrl(value);
		if (url === "") throw new TypeErrorCtor(${JSON.stringify(z)});
		const colon = url.indexOf(":");
		const scheme = colon === -1 ? "" : url.slice(0, colon).toLowerCase();
		if (scheme === "http" || scheme === "https") {
			throw new TypeErrorCtor("remote image URLs are not supported in tool outputs. Pass a base64 data URI instead");
		}
		const comma = url.indexOf(",");
		const header = comma === -1 ? [] : url.slice(colon + 1, comma).split(";");
		if (scheme !== "data" || comma === -1 || header.slice(1).every((part) => part.toLowerCase() !== "base64")) {
			throw new TypeErrorCtor("invalid image output. Pass a base64 data URI instead");
		}
		// Providers reject the whole request on a bad image, and a persisted image block would be
		// resent on every later turn. Line breaks from wrapped base64 are dropped. The declared type
		// is ignored in favor of the detected one, as providers also reject mismatches.
		const data = url.slice(comma + 1).replace(/\\s+/g, "");
		if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
			throw new TypeErrorCtor("invalid image output. The image data is not valid base64 (truncated or corrupted?)");
		}
		const head = data.slice(0, 16);
		const signature = IMAGE_SIGNATURES.find(([, pattern]) => pattern.test(head));
		if (!signature) {
			throw new TypeErrorCtor("invalid image output. The image data is not a PNG, JPEG, GIF, or WebP image");
		}
		output("image", data, signature[0]);
	}

	function exit() {
		let writesJson;
		try {
			writesJson = serializeWrites();
		} catch (error) {
			done(false, describeError(error));
			throw EXIT;
		}
		done(true, undefined, writesJson);
		throw EXIT;
	}

	const console = {};
	for (const level of ["log", "info", "warn", "error", "debug"]) {
		console[level] = (...args) => {
			output("console", args.map(format).join(" "));
		};
	}
	Object.freeze(console);

	Object.defineProperty(globalThis, "tools", { value: toolsProxy, enumerable: true });
	Object.defineProperty(globalThis, "ALL_TOOLS", { value: allTools, enumerable: true });
	Object.defineProperty(globalThis, "console", { value: console, enumerable: true });
	Object.defineProperty(globalThis, "text", { value: text, enumerable: true });
	Object.defineProperty(globalThis, "image", { value: image, enumerable: true });
	Object.defineProperty(globalThis, "exit", { value: exit, enumerable: true });

	return {
		settle(id, ok, payload, propertiesJson) {
			const entry = pending.get(id);
			if (!entry) return;
			pending.delete(id);
			if (!ok) {
				const error = new ErrorCtor(payload);
				if (propertiesJson !== undefined) {
					const properties = parse(propertiesJson);
					for (const key of Object.keys(properties)) {
						if (key === "name" || key === "message" || key === "stack") continue;
						Object.defineProperty(error, key, { value: properties[key], writable: true, enumerable: true, configurable: true });
					}
				}
				entry.reject(error);
				return;
			}
			let value;
			try {
				value = payload === undefined ? undefined : parse(payload);
			} catch (error) {
				entry.reject(error);
				return;
			}
			entry.resolve(value);
		},
		run(fn) {
			let promise;
			try {
				promise = fn(toolsProxy, console);
			} catch (error) {
				done(false, describeError(error));
				return;
			}
			promiseThen.call(
				promise,
				(value) => {
					let json;
					try {
						json = serialize(value);
					} catch (error) {
						done(false, describeError(error));
						return;
					}
					done(true, json, serializeWrites());
				},
				(error) => {
					done(false, describeError(error));
				},
			);
		},
		stalled() {
			if (finished || pending.size > 0) return false;
			done(
				false,
				stringify({
					name: "Error",
					message:
						"The script is waiting on a promise that can never settle: no tool call is pending, and timers do not exist here.",
				}),
			);
			return true;
		},
	};
})`;var ce=1;function ue(i){let e=2166136261;for(let t=0;t<i.length;t++)e^=i.charCodeAt(t),e=Math.imul(e,16777619);return(e>>>0).toString(16).padStart(8,"0")}var pe=ue($);function fe(i){let e=i>>>0;return()=>{e=e+1831565813>>>0;let t=Math.imul(e^e>>>15,1|e);return t=t+Math.imul(t^t>>>7,61|t)^t,(t^t>>>14)>>>0}}function de(i){let e=fe(i.seed^2654435769);return t=>({...Q(t),clock_time_get(r,s,n){let o;return i.creating?o=r===0?BigInt(i.seed+1)*1000n:0n:r===0?o=BigInt(Math.round(i.now))*1000000n:o=BigInt(Math.round(i.now-i.startedAt))*1000000n,new DataView(t.buffer).setBigUint64(n,o,!0),0},random_get(r,s){let n=new Uint8Array(t.buffer,r,s);for(let o=0;o<s;o+=4){let a=e();for(let l=0;l<4&&o+l<s;l++)n[o+l]=a>>>l*8}return 0}})}function Q(i){return{fd_write(e,t,r,s){let n=new DataView(i.buffer),o=0;for(let a=0;a<r;a++)o+=n.getUint32(t+a*8+4,!0);return n.setUint32(s,o,!0),0}}}function me(i){let e=i.message?`${i.name}: ${i.message}`:i.name,t=i.stack?.trimEnd();return JSON.stringify({name:i.name,message:i.message,stack:t?`${e}
${t}`:e})}var he=50;function Y(i){return{type:"crash",message:i instanceof Error?`${i.name}: ${i.message}`:String(i)}}async function Z(i){let{data:e,post:t}=i,r=i.maxStackSize??H,s=e.deterministic,n=s&&{creating:!0,startedAt:s.startedAt,now:s.startedAt,seed:s.seed>>>0},o=await I.create({wasm:i.wasm,memoryLimit:e.memoryLimitBytes,maxStackSize:r,interruptHandler:i.shouldInterrupt,wasi:n?de(n):Q,...n?{timezoneOffset:0,intrinsics:M.ALL&~M.WEAK_REF}:{}});n&&(n.creating=!1);let a=!1,l=0,u=1,c=0,p=new Map,h=_=>{o.withScope(()=>{o.callFunction(w,d,o.newNumber(_.id),_.ok?o.true:o.false,_.payload===void 0?o.undefined:o.newString(_.payload),_.properties===void 0?o.undefined:o.newString(_.properties))}),y()},g={deliver(_){if(!a)try{if(!n){h(_);return}let{seq:x}=_;if(x===void 0||!Number.isInteger(x)||x<u||p.has(x))throw new Error(`Result ${_.id} has sequence number ${x}, expected ${u} or later, once`);p.set(x,_);for(let j=p.get(u);j!==void 0;j=p.get(u))p.delete(u),j.now!==void 0&&Number.isFinite(j.now)&&(n.now=Math.max(n.now,j.now)),c=u,h(j),t({type:"idle",seq:u,issued:l}),u++}catch(x){t(Y(x))}},dispose(){a||(a=!0,o.dispose())}},d,w,P,S=o._getExports(),y=()=>{let _=0;for(;S.qjs_is_job_pending();){if(S.qjs_execute_pending_job()<0)throw new Error("Promise job failed");if(++_%he===0&&i.shouldInterrupt())throw new Error("Execution interrupted")}o.callFunction(P,d).dispose()};try{let _=o.newFunction("bridge",(b,k,v,f)=>{switch(b.toString()){case"call":case"global":l++,t({type:"call",id:k.toNumber(),target:b.toString()==="call"?"tool":"global",name:v.toString(),args:f===void 0||f.isUndefined?void 0:f.toString()});break;case"output":t({type:"output",item:k.toString()==="image"?{type:"image",data:v.toString(),mimeType:f.toString()}:k.toString()==="console"?{type:"text",text:v.toString(),console:!0}:{type:"text",text:v.toString()}});break;case"done":{let E=n?{during:{seq:c,issued:l}}:{};k.toBoolean()?t({type:"done",ok:!0,value:v===void 0||v.isUndefined?void 0:v.toString(),writes:f.toString(),...E}):t({type:"done",ok:!1,error:v.toString(),...E});break}}return o.undefined});d=o.withScope(b=>b.escape(o.callFunction(o.evalCode($,"codemode-prelude.js"),o.undefined,_,o.newString(JSON.stringify(e.tools)),o.newString(JSON.stringify(e.globals)),o.newString(JSON.stringify(e.store))))),w=d.getProp("settle");let x=d.getProp("run");if(P=d.getProp("stalled"),n){let b=o.versions,k=i.interruptBudget??"none";t({type:"started",fingerprint:`quickjs-wasi ${b["quickjs-wasi"]}, quickjs ${b.quickjs}, prelude ${pe}, deterministic ${ce}, stack ${r}, heap ${e.memoryLimitBytes??"none"}, budget ${k}`})}let j;try{j=o.evalCode(`(async (tools, console) => {${e.code}
})`,"codemode.js")}catch(b){if(!(b instanceof O))throw b;return t({type:"done",ok:!1,error:me(b)}),g}o.callFunction(x,d,j).dispose(),j.dispose(),y(),n&&t({type:"idle",seq:0,issued:l})}catch(_){t(Y(_))}return g}function ee(i){U.parentPort?.postMessage(i)}async function _e(i){let e=new Int32Array(i.interrupt),t=await Z({data:i,wasm:i.wasm,post:ee,shouldInterrupt:()=>Atomics.load(e,0)!==0});U.parentPort?.on("message",r=>{J(r)&&t.deliver(r)})}U.parentPort&&_e(U.workerData).catch(i=>{ee({type:"crash",message:i instanceof Error?`${i.name}: ${i.message}`:String(i)})});
