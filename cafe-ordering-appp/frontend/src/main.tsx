import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import "./style.css";

type Item={id:string,name:string,description:string,price_paise:number,category:string};
type Cart=Record<string,number>;

const money=(p:number)=>`₹${(p/100).toFixed(0)}`;
const api=async(path:string,opts:any={})=>{
 const r=await fetch("/api"+path,{headers:{"Content-Type":"application/json",...(opts.headers||{})},...opts});
 const d=await r.json(); if(!r.ok) throw new Error(d.error||"Request failed"); return d;
};

function App(){
 const [items,setItems]=useState<Item[]>([]),[cart,setCart]=useState<Cart>({}),[mobile,setMobile]=useState(""),[otp,setOtp]=useState(""),[verified,setVerified]=useState(!!localStorage.cafeToken),[sent,setSent]=useState(false),[orderType,setOrderType]=useState("DINE_IN"),[table,setTable]=useState(""),[message,setMessage]=useState("");
 useEffect(()=>{api("/menu").then(setItems).catch(e=>setMessage(e.message))},[]);
 const add=(id:string)=>setCart(c=>({...c,[id]:(c[id]||0)+1}));
 const remove=(id:string)=>setCart(c=>{const n={...c}; n[id]=(n[id]||0)-1;if(n[id]<=0)delete n[id];return n});
 const total=Object.entries(cart).reduce((s,[id,q])=>s+(items.find(x=>x.id===id)?.price_paise||0)*q,0);
 async function sendOtp(){try{await api("/auth/send-otp",{method:"POST",body:JSON.stringify({mobile})});setSent(true);setMessage("OTP sent. Check your SMS.");}catch(e:any){setMessage(e.message)}}
 async function verify(){try{const d=await api("/auth/verify-otp",{method:"POST",body:JSON.stringify({mobile,otp})});localStorage.cafeToken=d.token;setVerified(true);setMessage("Mobile number verified.");}catch(e:any){setMessage(e.message)}}
 async function place(){try{const d=await api("/orders",{method:"POST",headers:{Authorization:`Bearer ${localStorage.cafeToken}`},body:JSON.stringify({orderType,tableNumber:table||null,items:Object.entries(cart).map(([menuItemId,quantity])=>({menuItemId,quantity}))})});setCart({});setMessage(`Order #${d.order_number} placed successfully.`)}catch(e:any){setMessage(e.message)}}
 return <div className="page"><header><div><h1>☕ Your Café</h1><p>Fresh food. Simple ordering.</p></div><a href="/admin.html">Staff</a></header>
 <main><section><h2>Menu</h2><div className="grid">{items.map(i=><article className="card" key={i.id}><span>{i.category}</span><h3>{i.name}</h3><p>{i.description}</p><b>{money(i.price_paise)}</b><button onClick={()=>add(i.id)}>Add</button></article>)}</div></section>
 <aside><h2>Your order</h2>{Object.entries(cart).map(([id,q])=>{const i=items.find(x=>x.id===id)!;return <div className="line" key={id}><span>{i.name} × {q}</span><span>{money(i.price_paise*q)} <button className="small" onClick={()=>remove(id)}>−</button><button className="small" onClick={()=>add(id)}>+</button></span></div>})}<hr/><strong>Total: {money(total)}</strong>
 {!verified&&<div className="verify"><h3>Verify mobile</h3><input placeholder="Mobile number" value={mobile} onChange={e=>setMobile(e.target.value)}/>{!sent?<button onClick={sendOtp}>Send OTP</button>:<><input placeholder="6-digit OTP" value={otp} onChange={e=>setOtp(e.target.value)}/><button onClick={verify}>Verify OTP</button></>}</div>}
 {verified&&<><select value={orderType} onChange={e=>setOrderType(e.target.value)}><option value="DINE_IN">Dine in</option><option value="TAKEAWAY">Takeaway</option></select>{orderType==="DINE_IN"&&<input placeholder="Table number" value={table} onChange={e=>setTable(e.target.value)}/>}<button className="place" disabled={!Object.keys(cart).length} onClick={place}>Place Order</button></>}
 {message&&<p className="message">{message}</p>}</aside></main></div>
}
createRoot(document.getElementById("root")!).render(<App/>);
