import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, Send, Sparkles, UserRound } from 'lucide-react';
import './styles.css';

const welcome = 'สวัสดีครับ ผมคือ CED/TCT Assistant สามารถสอบถามข้อมูลเกี่ยวกับหลักสูตร รายวิชา คุณสมบัติผู้สมัคร ค่าเล่าเรียน และการรับสมัคร CED/TCT ได้ครับ';
const suggestions = ['CED ค่าเทอมเท่าไหร่', 'รหัสสมัคร TCT คืออะไร', 'ปวส สมัคร TCT ได้ไหม', 'ภาษาอังกฤษ 1 กี่หน่วยกิต'];

function App() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState([{ role: 'bot', text: welcome }]);
  const [input, setInput] = useState(''); const [loading, setLoading] = useState(false); const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);
  async function send(text = input) {
    const message = text.trim(); if (!message || loading) return;
    setMessages((items) => [...items, { role: 'user', text: message }]); setInput(''); setLoading(true);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'ไม่สามารถประมวลผลคำถามได้');
      setMessages((items) => [...items, { role: 'bot', text: data.answer, source: data.source }]);
    } catch (error) { setMessages((items) => [...items, { role: 'bot', text: `ขออภัยครับ ระบบขัดข้องชั่วคราว: ${error.message}` }]); }
    finally { setLoading(false); }
  }
  return <main className="page"><section className="chat-card">
    <header><div className="brand"><span className="brand-icon"><Bot size={24}/></span><span><strong>CED/TCT Assistant</strong><small><i/> พร้อมให้ข้อมูลจาก Dataset</small></span></div><Sparkles size={20} className="sparkle" /></header>
    <div className="intro"><h1>ถามข้อมูล CED/TCT ได้เลย</h1><p>คำตอบอ้างอิงจากฐานข้อมูลหลักสูตรและการรับสมัครเท่านั้น</p><div className="suggestions">{suggestions.map((item) => <button key={item} onClick={() => send(item)}>{item}</button>)}</div></div>
    <div className="messages" aria-live="polite">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><span className="avatar">{message.role === 'bot' ? <Bot size={18}/> : <UserRound size={18}/>}</span><div className="bubble">{message.text.split('\n').map((line, lineIndex) => <React.Fragment key={lineIndex}>{line}{lineIndex < message.text.split('\n').length - 1 && <br/>}</React.Fragment>)}</div></div>)}{loading && <div className="message bot"><span className="avatar"><Bot size={18}/></span><div className="bubble typing"><b></b><b></b><b></b></div></div>}<div ref={endRef}/></div>
    <form onSubmit={(event) => { event.preventDefault(); send(); }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="พิมพ์คำถามเกี่ยวกับ CED/TCT..." aria-label="คำถาม" disabled={loading}/><button type="submit" disabled={!input.trim() || loading} aria-label="ส่งข้อความ"><Send size={20}/></button></form><footer>กด Enter เพื่อส่งข้อความ</footer>
  </section></main>;
}
createRoot(document.getElementById('root')).render(<App />);
