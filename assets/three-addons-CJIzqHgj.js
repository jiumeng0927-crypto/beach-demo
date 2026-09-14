import{E as Ie,V as E,M as Z,T as V,S as Ae,Q as Re,a as N,R as ot,P as Ne,b as nt,B as te,c as it,d as rt,e as De,f as at,g as Ue,h as Be,i as st,U as he,j as lt,C as ae,F as ct,k as fe,l as Ce,m as ut,W as mt,n as ke,o as ft}from"./three-core-BP5g306q.js";const Le={type:"change"},de={type:"start"},Oe={type:"end"},se=new ot,_e=new Ne,dt=Math.cos(70*nt.DEG2RAD);class wt extends Ie{constructor(c,o){super(),this.object=c,this.domElement=o,this.domElement.style.touchAction="none",this.enabled=!0,this.target=new E,this.cursor=new E,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:Z.ROTATE,MIDDLE:Z.DOLLY,RIGHT:Z.PAN},this.touches={ONE:V.ROTATE,TWO:V.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return u.phi},this.getAzimuthalAngle=function(){return u.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(t){t.addEventListener("keydown",ue),this._domElementKeyEvents=t},this.stopListenToKeyEvents=function(){this._domElementKeyEvents.removeEventListener("keydown",ue),this._domElementKeyEvents=null},this.saveState=function(){e.target0.copy(e.target),e.position0.copy(e.object.position),e.zoom0=e.object.zoom},this.reset=function(){e.target.copy(e.target0),e.object.position.copy(e.position0),e.object.zoom=e.zoom0,e.object.updateProjectionMatrix(),e.dispatchEvent(Le),e.update(),l=i.NONE},this.update=(function(){const t=new E,n=new Re().setFromUnitVectors(c.up,new E(0,1,0)),b=n.clone().invert(),y=new E,O=new Re,X=new E,I=2*Math.PI;return function(tt=null){const Se=e.object.position;t.copy(Se).sub(e.target),t.applyQuaternion(n),u.setFromVector3(t),e.autoRotate&&l===i.NONE&&j(z(tt)),e.enableDamping?(u.theta+=d.theta*e.dampingFactor,u.phi+=d.phi*e.dampingFactor):(u.theta+=d.theta,u.phi+=d.phi);let G=e.minAzimuthAngle,Y=e.maxAzimuthAngle;isFinite(G)&&isFinite(Y)&&(G<-Math.PI?G+=I:G>Math.PI&&(G-=I),Y<-Math.PI?Y+=I:Y>Math.PI&&(Y-=I),G<=Y?u.theta=Math.max(G,Math.min(Y,u.theta)):u.theta=u.theta>(G+Y)/2?Math.max(G,u.theta):Math.min(Y,u.theta)),u.phi=Math.max(e.minPolarAngle,Math.min(e.maxPolarAngle,u.phi)),u.makeSafe(),e.enableDamping===!0?e.target.addScaledVector(r,e.dampingFactor):e.target.add(r),e.target.sub(e.cursor),e.target.clampLength(e.minTargetRadius,e.maxTargetRadius),e.target.add(e.cursor),e.zoomToCursor&&S||e.object.isOrthographicCamera?u.radius=_(u.radius):u.radius=_(u.radius*v),t.setFromSpherical(u),t.applyQuaternion(b),Se.copy(e.target).add(t),e.object.lookAt(e.target),e.enableDamping===!0?(d.theta*=1-e.dampingFactor,d.phi*=1-e.dampingFactor,r.multiplyScalar(1-e.dampingFactor)):(d.set(0,0,0),r.set(0,0,0));let me=!1;if(e.zoomToCursor&&S){let J=null;if(e.object.isPerspectiveCamera){const ee=t.length();J=_(ee*v);const re=ee-J;e.object.position.addScaledVector(P,re),e.object.updateMatrixWorld()}else if(e.object.isOrthographicCamera){const ee=new E(f.x,f.y,0);ee.unproject(e.object),e.object.zoom=Math.max(e.minZoom,Math.min(e.maxZoom,e.object.zoom/v)),e.object.updateProjectionMatrix(),me=!0;const re=new E(f.x,f.y,0);re.unproject(e.object),e.object.position.sub(re).add(ee),e.object.updateMatrixWorld(),J=t.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),e.zoomToCursor=!1;J!==null&&(this.screenSpacePanning?e.target.set(0,0,-1).transformDirection(e.object.matrix).multiplyScalar(J).add(e.object.position):(se.origin.copy(e.object.position),se.direction.set(0,0,-1).transformDirection(e.object.matrix),Math.abs(e.object.up.dot(se.direction))<dt?c.lookAt(e.target):(_e.setFromNormalAndCoplanarPoint(e.object.up,e.target),se.intersectPlane(_e,e.target))))}else e.object.isOrthographicCamera&&(e.object.zoom=Math.max(e.minZoom,Math.min(e.maxZoom,e.object.zoom/v)),e.object.updateProjectionMatrix(),me=!0);return v=1,S=!1,me||y.distanceToSquared(e.object.position)>s||8*(1-O.dot(e.object.quaternion))>s||X.distanceToSquared(e.target)>0?(e.dispatchEvent(Le),y.copy(e.object.position),O.copy(e.object.quaternion),X.copy(e.target),!0):!1}})(),this.dispose=function(){e.domElement.removeEventListener("contextmenu",Pe),e.domElement.removeEventListener("pointerdown",we),e.domElement.removeEventListener("pointercancel",$),e.domElement.removeEventListener("wheel",Te),e.domElement.removeEventListener("pointermove",ce),e.domElement.removeEventListener("pointerup",$),e._domElementKeyEvents!==null&&(e._domElementKeyEvents.removeEventListener("keydown",ue),e._domElementKeyEvents=null)};const e=this,i={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6};let l=i.NONE;const s=1e-6,u=new Ae,d=new Ae;let v=1;const r=new E,h=new N,w=new N,m=new N,R=new N,C=new N,U=new N,D=new N,g=new N,x=new N,P=new E,f=new N;let S=!1;const p=[],k={};function z(t){return t!==null?2*Math.PI/60*e.autoRotateSpeed*t:2*Math.PI/60/60*e.autoRotateSpeed}function L(t){const n=Math.abs(t)/(100*(window.devicePixelRatio|0));return Math.pow(.95,e.zoomSpeed*n)}function j(t){d.theta-=t}function A(t){d.phi-=t}const B=(function(){const t=new E;return function(b,y){t.setFromMatrixColumn(y,0),t.multiplyScalar(-b),r.add(t)}})(),H=(function(){const t=new E;return function(b,y){e.screenSpacePanning===!0?t.setFromMatrixColumn(y,1):(t.setFromMatrixColumn(y,0),t.crossVectors(e.object.up,t)),t.multiplyScalar(b),r.add(t)}})(),M=(function(){const t=new E;return function(b,y){const O=e.domElement;if(e.object.isPerspectiveCamera){const X=e.object.position;t.copy(X).sub(e.target);let I=t.length();I*=Math.tan(e.object.fov/2*Math.PI/180),B(2*b*I/O.clientHeight,e.object.matrix),H(2*y*I/O.clientHeight,e.object.matrix)}else e.object.isOrthographicCamera?(B(b*(e.object.right-e.object.left)/e.object.zoom/O.clientWidth,e.object.matrix),H(y*(e.object.top-e.object.bottom)/e.object.zoom/O.clientHeight,e.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),e.enablePan=!1)}})();function T(t){e.object.isPerspectiveCamera||e.object.isOrthographicCamera?v/=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),e.enableZoom=!1)}function W(t){e.object.isPerspectiveCamera||e.object.isOrthographicCamera?v*=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),e.enableZoom=!1)}function F(t,n){if(!e.zoomToCursor)return;S=!0;const b=e.domElement.getBoundingClientRect(),y=t-b.left,O=n-b.top,X=b.width,I=b.height;f.x=y/X*2-1,f.y=-(O/I)*2+1,P.set(f.x,f.y,1).unproject(e.object).sub(e.object.position).normalize()}function _(t){return Math.max(e.minDistance,Math.min(e.maxDistance,t))}function oe(t){h.set(t.clientX,t.clientY)}function le(t){F(t.clientX,t.clientX),D.set(t.clientX,t.clientY)}function ne(t){R.set(t.clientX,t.clientY)}function ie(t){w.set(t.clientX,t.clientY),m.subVectors(w,h).multiplyScalar(e.rotateSpeed);const n=e.domElement;j(2*Math.PI*m.x/n.clientHeight),A(2*Math.PI*m.y/n.clientHeight),h.copy(w),e.update()}function He(t){g.set(t.clientX,t.clientY),x.subVectors(g,D),x.y>0?T(L(x.y)):x.y<0&&W(L(x.y)),D.copy(g),e.update()}function Fe(t){C.set(t.clientX,t.clientY),U.subVectors(C,R).multiplyScalar(e.panSpeed),M(U.x,U.y),R.copy(C),e.update()}function Ge(t){F(t.clientX,t.clientY),t.deltaY<0?W(L(t.deltaY)):t.deltaY>0&&T(L(t.deltaY)),e.update()}function Ye(t){let n=!1;switch(t.code){case e.keys.UP:t.ctrlKey||t.metaKey||t.shiftKey?A(2*Math.PI*e.rotateSpeed/e.domElement.clientHeight):M(0,e.keyPanSpeed),n=!0;break;case e.keys.BOTTOM:t.ctrlKey||t.metaKey||t.shiftKey?A(-2*Math.PI*e.rotateSpeed/e.domElement.clientHeight):M(0,-e.keyPanSpeed),n=!0;break;case e.keys.LEFT:t.ctrlKey||t.metaKey||t.shiftKey?j(2*Math.PI*e.rotateSpeed/e.domElement.clientHeight):M(e.keyPanSpeed,0),n=!0;break;case e.keys.RIGHT:t.ctrlKey||t.metaKey||t.shiftKey?j(-2*Math.PI*e.rotateSpeed/e.domElement.clientHeight):M(-e.keyPanSpeed,0),n=!0;break}n&&(t.preventDefault(),e.update())}function ge(t){if(p.length===1)h.set(t.pageX,t.pageY);else{const n=K(t),b=.5*(t.pageX+n.x),y=.5*(t.pageY+n.y);h.set(b,y)}}function be(t){if(p.length===1)R.set(t.pageX,t.pageY);else{const n=K(t),b=.5*(t.pageX+n.x),y=.5*(t.pageY+n.y);R.set(b,y)}}function ve(t){const n=K(t),b=t.pageX-n.x,y=t.pageY-n.y,O=Math.sqrt(b*b+y*y);D.set(0,O)}function Xe(t){e.enableZoom&&ve(t),e.enablePan&&be(t)}function We(t){e.enableZoom&&ve(t),e.enableRotate&&ge(t)}function ye(t){if(p.length==1)w.set(t.pageX,t.pageY);else{const b=K(t),y=.5*(t.pageX+b.x),O=.5*(t.pageY+b.y);w.set(y,O)}m.subVectors(w,h).multiplyScalar(e.rotateSpeed);const n=e.domElement;j(2*Math.PI*m.x/n.clientHeight),A(2*Math.PI*m.y/n.clientHeight),h.copy(w)}function Ee(t){if(p.length===1)C.set(t.pageX,t.pageY);else{const n=K(t),b=.5*(t.pageX+n.x),y=.5*(t.pageY+n.y);C.set(b,y)}U.subVectors(C,R).multiplyScalar(e.panSpeed),M(U.x,U.y),R.copy(C)}function xe(t){const n=K(t),b=t.pageX-n.x,y=t.pageY-n.y,O=Math.sqrt(b*b+y*y);g.set(0,O),x.set(0,Math.pow(g.y/D.y,e.zoomSpeed)),T(x.y),D.copy(g);const X=(t.pageX+n.x)*.5,I=(t.pageY+n.y)*.5;F(X,I)}function Ke(t){e.enableZoom&&xe(t),e.enablePan&&Ee(t)}function Ze(t){e.enableZoom&&xe(t),e.enableRotate&&ye(t)}function we(t){e.enabled!==!1&&(p.length===0&&(e.domElement.setPointerCapture(t.pointerId),e.domElement.addEventListener("pointermove",ce),e.domElement.addEventListener("pointerup",$)),Je(t),t.pointerType==="touch"?Qe(t):Ve(t))}function ce(t){e.enabled!==!1&&(t.pointerType==="touch"?$e(t):qe(t))}function $(t){et(t),p.length===0&&(e.domElement.releasePointerCapture(t.pointerId),e.domElement.removeEventListener("pointermove",ce),e.domElement.removeEventListener("pointerup",$)),e.dispatchEvent(Oe),l=i.NONE}function Ve(t){let n;switch(t.button){case 0:n=e.mouseButtons.LEFT;break;case 1:n=e.mouseButtons.MIDDLE;break;case 2:n=e.mouseButtons.RIGHT;break;default:n=-1}switch(n){case Z.DOLLY:if(e.enableZoom===!1)return;le(t),l=i.DOLLY;break;case Z.ROTATE:if(t.ctrlKey||t.metaKey||t.shiftKey){if(e.enablePan===!1)return;ne(t),l=i.PAN}else{if(e.enableRotate===!1)return;oe(t),l=i.ROTATE}break;case Z.PAN:if(t.ctrlKey||t.metaKey||t.shiftKey){if(e.enableRotate===!1)return;oe(t),l=i.ROTATE}else{if(e.enablePan===!1)return;ne(t),l=i.PAN}break;default:l=i.NONE}l!==i.NONE&&e.dispatchEvent(de)}function qe(t){switch(l){case i.ROTATE:if(e.enableRotate===!1)return;ie(t);break;case i.DOLLY:if(e.enableZoom===!1)return;He(t);break;case i.PAN:if(e.enablePan===!1)return;Fe(t);break}}function Te(t){e.enabled===!1||e.enableZoom===!1||l!==i.NONE||(t.preventDefault(),e.dispatchEvent(de),Ge(t),e.dispatchEvent(Oe))}function ue(t){e.enabled===!1||e.enablePan===!1||Ye(t)}function Qe(t){switch(Me(t),p.length){case 1:switch(e.touches.ONE){case V.ROTATE:if(e.enableRotate===!1)return;ge(t),l=i.TOUCH_ROTATE;break;case V.PAN:if(e.enablePan===!1)return;be(t),l=i.TOUCH_PAN;break;default:l=i.NONE}break;case 2:switch(e.touches.TWO){case V.DOLLY_PAN:if(e.enableZoom===!1&&e.enablePan===!1)return;Xe(t),l=i.TOUCH_DOLLY_PAN;break;case V.DOLLY_ROTATE:if(e.enableZoom===!1&&e.enableRotate===!1)return;We(t),l=i.TOUCH_DOLLY_ROTATE;break;default:l=i.NONE}break;default:l=i.NONE}l!==i.NONE&&e.dispatchEvent(de)}function $e(t){switch(Me(t),l){case i.TOUCH_ROTATE:if(e.enableRotate===!1)return;ye(t),e.update();break;case i.TOUCH_PAN:if(e.enablePan===!1)return;Ee(t),e.update();break;case i.TOUCH_DOLLY_PAN:if(e.enableZoom===!1&&e.enablePan===!1)return;Ke(t),e.update();break;case i.TOUCH_DOLLY_ROTATE:if(e.enableZoom===!1&&e.enableRotate===!1)return;Ze(t),e.update();break;default:l=i.NONE}}function Pe(t){e.enabled!==!1&&t.preventDefault()}function Je(t){p.push(t.pointerId)}function et(t){delete k[t.pointerId];for(let n=0;n<p.length;n++)if(p[n]==t.pointerId){p.splice(n,1);return}}function Me(t){let n=k[t.pointerId];n===void 0&&(n=new N,k[t.pointerId]=n),n.set(t.pageX,t.pageY)}function K(t){const n=t.pointerId===p[0]?p[1]:p[0];return k[n]}e.domElement.addEventListener("contextmenu",Pe),e.domElement.addEventListener("pointerdown",we),e.domElement.addEventListener("pointercancel",$),e.domElement.addEventListener("wheel",Te,{passive:!1}),this.update()}}function Tt(a,c=!1){const o=a[0].index!==null,e=new Set(Object.keys(a[0].attributes)),i=new Set(Object.keys(a[0].morphAttributes)),l={},s={},u=a[0].morphTargetsRelative,d=new it;let v=0;for(let r=0;r<a.length;++r){const h=a[r];let w=0;if(o!==(h.index!==null))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+r+". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them."),null;for(const m in h.attributes){if(!e.has(m))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+r+'. All geometries must have compatible attributes; make sure "'+m+'" attribute exists among all geometries, or in none of them.'),null;l[m]===void 0&&(l[m]=[]),l[m].push(h.attributes[m]),w++}if(w!==e.size)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+r+". Make sure all geometries have the same number of attributes."),null;if(u!==h.morphTargetsRelative)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+r+". .morphTargetsRelative must be consistent throughout all geometries."),null;for(const m in h.morphAttributes){if(!i.has(m))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+r+".  .morphAttributes must be consistent throughout all geometries."),null;s[m]===void 0&&(s[m]=[]),s[m].push(h.morphAttributes[m])}if(c){let m;if(o)m=h.index.count;else if(h.attributes.position!==void 0)m=h.attributes.position.count;else return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+r+". The geometry must have either an index or a position attribute"),null;d.addGroup(v,m,r),v+=m}}if(o){let r=0;const h=[];for(let w=0;w<a.length;++w){const m=a[w].index;for(let R=0;R<m.count;++R)h.push(m.getX(R)+r);r+=a[w].attributes.position.count}d.setIndex(h)}for(const r in l){const h=ze(l[r]);if(!h)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+r+" attribute."),null;d.setAttribute(r,h)}for(const r in s){const h=s[r][0].length;if(h===0)break;d.morphAttributes=d.morphAttributes||{},d.morphAttributes[r]=[];for(let w=0;w<h;++w){const m=[];for(let C=0;C<s[r].length;++C)m.push(s[r][C][w]);const R=ze(m);if(!R)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+r+" morphAttribute."),null;d.morphAttributes[r].push(R)}}return d}function ze(a){let c,o,e,i=-1,l=0;for(let v=0;v<a.length;++v){const r=a[v];if(r.isInterleavedBufferAttribute)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. InterleavedBufferAttributes are not supported."),null;if(c===void 0&&(c=r.array.constructor),c!==r.array.constructor)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes."),null;if(o===void 0&&(o=r.itemSize),o!==r.itemSize)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes."),null;if(e===void 0&&(e=r.normalized),e!==r.normalized)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes."),null;if(i===-1&&(i=r.gpuType),i!==r.gpuType)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes."),null;l+=r.array.length}const s=new c(l);let u=0;for(let v=0;v<a.length;++v)s.set(a[v].array,u),u+=a[v].array.length;const d=new te(s,o,e);return i!==void 0&&(d.gpuType=i),d}function Pt(a,c=1e-4){c=Math.max(c,Number.EPSILON);const o={},e=a.getIndex(),i=a.getAttribute("position"),l=e?e.count:i.count;let s=0;const u=Object.keys(a.attributes),d={},v={},r=[],h=["getX","getY","getZ","getW"],w=["setX","setY","setZ","setW"];for(let g=0,x=u.length;g<x;g++){const P=u[g],f=a.attributes[P];d[P]=new te(new f.array.constructor(f.count*f.itemSize),f.itemSize,f.normalized);const S=a.morphAttributes[P];S&&(v[P]=new te(new S.array.constructor(S.count*S.itemSize),S.itemSize,S.normalized))}const m=c*.5,R=Math.log10(1/c),C=Math.pow(10,R),U=m*C;for(let g=0;g<l;g++){const x=e?e.getX(g):g;let P="";for(let f=0,S=u.length;f<S;f++){const p=u[f],k=a.getAttribute(p),z=k.itemSize;for(let L=0;L<z;L++)P+=`${~~(k[h[L]](x)*C+U)},`}if(P in o)r.push(o[P]);else{for(let f=0,S=u.length;f<S;f++){const p=u[f],k=a.getAttribute(p),z=a.morphAttributes[p],L=k.itemSize,j=d[p],A=v[p];for(let B=0;B<L;B++){const H=h[B],M=w[B];if(j[M](s,k[H](x)),z)for(let T=0,W=z.length;T<W;T++)A[T][M](s,z[T][H](x))}}o[P]=s,r.push(s),s++}}const D=a.clone();for(const g in a.attributes){const x=d[g];if(D.setAttribute(g,new te(x.array.slice(0,s*x.itemSize),x.itemSize,x.normalized)),g in v)for(let P=0;P<v[g].length;P++){const f=v[g][P];D.morphAttributes[g][P]=new te(f.array.slice(0,s*f.itemSize),f.itemSize,f.normalized)}}return D.setIndex(r),D}function Mt(a,c){if(c===rt)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),a;if(c===De||c===at){let o=a.getIndex();if(o===null){const s=[],u=a.getAttribute("position");if(u!==void 0){for(let d=0;d<u.count;d++)s.push(d);a.setIndex(s),o=a.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),a}const e=o.count-2,i=[];if(c===De)for(let s=1;s<=e;s++)i.push(o.getX(0)),i.push(o.getX(s)),i.push(o.getX(s+1));else for(let s=0;s<e;s++)s%2===0?(i.push(o.getX(s)),i.push(o.getX(s+1)),i.push(o.getX(s+2))):(i.push(o.getX(s+2)),i.push(o.getX(s+1)),i.push(o.getX(s)));i.length/3!==e&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const l=a.clone();return l.setIndex(i),l.clearGroups(),l}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",c),a}class pe extends Ue{constructor(){const c=pe.SkyShader,o=new Be({name:c.name,uniforms:he.clone(c.uniforms),vertexShader:c.vertexShader,fragmentShader:c.fragmentShader,side:st,depthWrite:!1});super(new lt(1,1,1),o),this.isSky=!0}}pe.SkyShader={name:"SkyShader",uniforms:{turbidity:{value:2},rayleigh:{value:1},mieCoefficient:{value:.005},mieDirectionalG:{value:.8},sunPosition:{value:new E},up:{value:new E(0,1,0)}},vertexShader:`
		uniform vec3 sunPosition;
		uniform float rayleigh;
		uniform float turbidity;
		uniform float mieCoefficient;
		uniform vec3 up;

		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		// constants for atmospheric scattering
		const float e = 2.71828182845904523536028747135266249775724709369995957;
		const float pi = 3.141592653589793238462643383279502884197169;

		// wavelength of used primaries, according to preetham
		const vec3 lambda = vec3( 680E-9, 550E-9, 450E-9 );
		// this pre-calcuation replaces older TotalRayleigh(vec3 lambda) function:
		// (8.0 * pow(pi, 3.0) * pow(pow(n, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * pn)) / (3.0 * N * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * pn))
		const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

		// mie stuff
		// K coefficient for the primaries
		const float v = 4.0;
		const vec3 K = vec3( 0.686, 0.678, 0.666 );
		// MieConst = pi * pow( ( 2.0 * pi ) / lambda, vec3( v - 2.0 ) ) * K
		const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

		// earth shadow hack
		// cutoffAngle = pi / 1.95;
		const float cutoffAngle = 1.6110731556870734;
		const float steepness = 1.5;
		const float EE = 1000.0;

		float sunIntensity( float zenithAngleCos ) {
			zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
			return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
		}

		vec3 totalMie( float T ) {
			float c = ( 0.2 * T ) * 10E-18;
			return 0.434 * c * MieConst;
		}

		void main() {

			vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
			vWorldPosition = worldPosition.xyz;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			gl_Position.z = gl_Position.w; // set z to camera.far

			vSunDirection = normalize( sunPosition );

			vSunE = sunIntensity( dot( vSunDirection, up ) );

			vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );

			float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );

			// extinction (absorbtion + out scattering)
			// rayleigh coefficients
			vBetaR = totalRayleigh * rayleighCoefficient;

			// mie coefficients
			vBetaM = totalMie( turbidity ) * mieCoefficient;

		}`,fragmentShader:`
		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		uniform float mieDirectionalG;
		uniform vec3 up;

		// constants for atmospheric scattering
		const float pi = 3.141592653589793238462643383279502884197169;

		const float n = 1.0003; // refractive index of air
		const float N = 2.545E25; // number of molecules per unit volume for air at 288.15K and 1013mb (sea level -45 celsius)

		// optical length at zenith for molecules
		const float rayleighZenithLength = 8.4E3;
		const float mieZenithLength = 1.25E3;
		// 66 arc seconds -> degrees, and the cosine of that
		const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

		// 3.0 / ( 16.0 * pi )
		const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
		// 1.0 / ( 4.0 * pi )
		const float ONE_OVER_FOURPI = 0.07957747154594767;

		float rayleighPhase( float cosTheta ) {
			return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
		}

		float hgPhase( float cosTheta, float g ) {
			float g2 = pow( g, 2.0 );
			float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
			return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
		}

		void main() {

			vec3 direction = normalize( vWorldPosition - cameraPosition );

			// optical length
			// cutoff angle at 90 to avoid singularity in next formula.
			float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
			float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
			float sR = rayleighZenithLength * inverse;
			float sM = mieZenithLength * inverse;

			// combined extinction factor
			vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

			// in scattering
			float cosTheta = dot( direction, vSunDirection );

			float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
			vec3 betaRTheta = vBetaR * rPhase;

			float mPhase = hgPhase( cosTheta, mieDirectionalG );
			vec3 betaMTheta = vBetaM * mPhase;

			vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
			Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );

			// nightsky
			float theta = acos( direction.y ); // elevation --> y-axis, [-pi/2, pi/2]
			float phi = atan( direction.z, direction.x ); // azimuth --> x-axis [-pi/2, pi/2]
			vec2 uv = vec2( phi, theta ) / vec2( 2.0 * pi, pi ) + vec2( 0.5, 0.0 );
			vec3 L0 = vec3( 0.1 ) * Fex;

			// composition + solar disc
			float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );
			L0 += ( vSunE * 19000.0 * Fex ) * sundisk;

			vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );

			vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );

			gl_FragColor = vec4( retColor, 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};class St extends Ue{constructor(c,o={}){super(c),this.isWater=!0;const e=this,i=o.textureWidth!==void 0?o.textureWidth:512,l=o.textureHeight!==void 0?o.textureHeight:512,s=o.clipBias!==void 0?o.clipBias:0,u=o.alpha!==void 0?o.alpha:1,d=o.time!==void 0?o.time:0,v=o.waterNormals!==void 0?o.waterNormals:null,r=o.sunDirection!==void 0?o.sunDirection:new E(.70707,.70707,0),h=new ae(o.sunColor!==void 0?o.sunColor:16777215),w=new ae(o.waterColor!==void 0?o.waterColor:8355711),m=o.eye!==void 0?o.eye:new E(0,0,0),R=o.distortionScale!==void 0?o.distortionScale:20,C=o.side!==void 0?o.side:ct,U=o.fog!==void 0?o.fog:!1,D=new Ne,g=new E,x=new E,P=new E,f=new fe,S=new E(0,0,-1),p=new Ce,k=new E,z=new E,L=new Ce,j=new fe,A=new ut,B=new mt(i,l),H={name:"MirrorShader",uniforms:he.merge([ke.fog,ke.lights,{normalSampler:{value:null},mirrorSampler:{value:null},alpha:{value:1},time:{value:0},size:{value:1},distortionScale:{value:20},textureMatrix:{value:new fe},sunColor:{value:new ae(8355711)},sunDirection:{value:new E(.70707,.70707,0)},eye:{value:new E},waterColor:{value:new ae(5592405)}}]),vertexShader:`
				uniform mat4 textureMatrix;
				uniform float time;

				varying vec4 mirrorCoord;
				varying vec4 worldPosition;

				#include <common>
				#include <fog_pars_vertex>
				#include <shadowmap_pars_vertex>
				#include <logdepthbuf_pars_vertex>

				void main() {
					mirrorCoord = modelMatrix * vec4( position, 1.0 );
					worldPosition = mirrorCoord.xyzw;
					mirrorCoord = textureMatrix * mirrorCoord;
					vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );
					gl_Position = projectionMatrix * mvPosition;

				#include <beginnormal_vertex>
				#include <defaultnormal_vertex>
				#include <logdepthbuf_vertex>
				#include <fog_vertex>
				#include <shadowmap_vertex>
			}`,fragmentShader:`
				uniform sampler2D mirrorSampler;
				uniform float alpha;
				uniform float time;
				uniform float size;
				uniform float distortionScale;
				uniform sampler2D normalSampler;
				uniform vec3 sunColor;
				uniform vec3 sunDirection;
				uniform vec3 eye;
				uniform vec3 waterColor;

				varying vec4 mirrorCoord;
				varying vec4 worldPosition;

				vec4 getNoise( vec2 uv ) {
					vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);
					vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );
					vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
					vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
					vec4 noise = texture2D( normalSampler, uv0 ) +
						texture2D( normalSampler, uv1 ) +
						texture2D( normalSampler, uv2 ) +
						texture2D( normalSampler, uv3 );
					return noise * 0.5 - 1.0;
				}

				void sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {
					vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );
					float direction = max( 0.0, dot( eyeDirection, reflection ) );
					specularColor += pow( direction, shiny ) * sunColor * spec;
					diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;
				}

				#include <common>
				#include <packing>
				#include <bsdfs>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <lights_pars_begin>
				#include <shadowmap_pars_fragment>
				#include <shadowmask_pars_fragment>

				void main() {

					#include <logdepthbuf_fragment>
					vec4 noise = getNoise( worldPosition.xz * size );
					vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );

					vec3 diffuseLight = vec3(0.0);
					vec3 specularLight = vec3(0.0);

					vec3 worldToEye = eye-worldPosition.xyz;
					vec3 eyeDirection = normalize( worldToEye );
					sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );

					float distance = length(worldToEye);

					vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;
					vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );

					float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );
					float rf0 = 0.3;
					float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );
					vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;
					vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);
					vec3 outgoingLight = albedo;
					gl_FragColor = vec4( outgoingLight, alpha );

					#include <tonemapping_fragment>
					#include <colorspace_fragment>
					#include <fog_fragment>	
				}`},M=new Be({name:H.name,uniforms:he.clone(H.uniforms),vertexShader:H.vertexShader,fragmentShader:H.fragmentShader,lights:!0,side:C,fog:U});M.uniforms.mirrorSampler.value=B.texture,M.uniforms.textureMatrix.value=j,M.uniforms.alpha.value=u,M.uniforms.time.value=d,M.uniforms.normalSampler.value=v,M.uniforms.sunColor.value=h,M.uniforms.waterColor.value=w,M.uniforms.sunDirection.value=r,M.uniforms.distortionScale.value=R,M.uniforms.eye.value=m,e.material=M,e.onBeforeRender=function(T,W,F){if(x.setFromMatrixPosition(e.matrixWorld),P.setFromMatrixPosition(F.matrixWorld),f.extractRotation(e.matrixWorld),g.set(0,0,1),g.applyMatrix4(f),k.subVectors(x,P),k.dot(g)>0)return;k.reflect(g).negate(),k.add(x),f.extractRotation(F.matrixWorld),S.set(0,0,-1),S.applyMatrix4(f),S.add(P),z.subVectors(x,S),z.reflect(g).negate(),z.add(x),A.position.copy(k),A.up.set(0,1,0),A.up.applyMatrix4(f),A.up.reflect(g),A.lookAt(z),A.far=F.far,A.updateMatrixWorld(),A.projectionMatrix.copy(F.projectionMatrix),j.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),j.multiply(A.projectionMatrix),j.multiply(A.matrixWorldInverse),D.setFromNormalAndCoplanarPoint(g,x),D.applyMatrix4(A.matrixWorldInverse),p.set(D.normal.x,D.normal.y,D.normal.z,D.constant);const _=A.projectionMatrix;L.x=(Math.sign(p.x)+_.elements[8])/_.elements[0],L.y=(Math.sign(p.y)+_.elements[9])/_.elements[5],L.z=-1,L.w=(1+_.elements[10])/_.elements[14],p.multiplyScalar(2/p.dot(L)),_.elements[2]=p.x,_.elements[6]=p.y,_.elements[10]=p.z+1-s,_.elements[14]=p.w,m.setFromMatrixPosition(F.matrixWorld);const oe=T.getRenderTarget(),le=T.xr.enabled,ne=T.shadowMap.autoUpdate;e.visible=!1,T.xr.enabled=!1,T.shadowMap.autoUpdate=!1,T.setRenderTarget(B),T.state.buffers.depth.setMask(!0),T.autoClear===!1&&T.clear(),T.render(W,A),e.visible=!0,T.xr.enabled=le,T.shadowMap.autoUpdate=ne,T.setRenderTarget(oe);const ie=F.viewport;ie!==void 0&&T.state.viewport(ie)}}}const q=new ft(0,0,0,"YXZ"),Q=new E,ht={type:"change"},pt={type:"lock"},gt={type:"unlock"},je=Math.PI/2;class At extends Ie{constructor(c,o){super(),this.camera=c,this.domElement=o,this.isLocked=!1,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.pointerSpeed=1,this._onMouseMove=bt.bind(this),this._onPointerlockChange=vt.bind(this),this._onPointerlockError=yt.bind(this),this.connect()}connect(){this.domElement.ownerDocument.addEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.addEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.addEventListener("pointerlockerror",this._onPointerlockError)}disconnect(){this.domElement.ownerDocument.removeEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.removeEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.removeEventListener("pointerlockerror",this._onPointerlockError)}dispose(){this.disconnect()}getObject(){return this.camera}getDirection(c){return c.set(0,0,-1).applyQuaternion(this.camera.quaternion)}moveForward(c){const o=this.camera;Q.setFromMatrixColumn(o.matrix,0),Q.crossVectors(o.up,Q),o.position.addScaledVector(Q,c)}moveRight(c){const o=this.camera;Q.setFromMatrixColumn(o.matrix,0),o.position.addScaledVector(Q,c)}lock(){this.domElement.requestPointerLock()}unlock(){this.domElement.ownerDocument.exitPointerLock()}}function bt(a){if(this.isLocked===!1)return;const c=a.movementX||a.mozMovementX||a.webkitMovementX||0,o=a.movementY||a.mozMovementY||a.webkitMovementY||0,e=this.camera;q.setFromQuaternion(e.quaternion),q.y-=c*.002*this.pointerSpeed,q.x-=o*.002*this.pointerSpeed,q.x=Math.max(je-this.maxPolarAngle,Math.min(je-this.minPolarAngle,q.x)),e.quaternion.setFromEuler(q),this.dispatchEvent(ht)}function vt(){this.domElement.ownerDocument.pointerLockElement===this.domElement?(this.dispatchEvent(pt),this.isLocked=!0):(this.dispatchEvent(gt),this.isLocked=!1)}function yt(){console.error("THREE.PointerLockControls: Unable to use Pointer Lock API")}export{wt as O,At as P,pe as S,St as W,Pt as a,Tt as m,Mt as t};
