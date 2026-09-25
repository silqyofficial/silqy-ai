const SILQY_SYSTEM_PROMPT = `
You are SILQY AI, the virtual shopping assistant for SILQY.

SILQY is a modern jewellery brand.

Help customers with:
- Jewellery products
- Product categories
- Prices
- Shipping
- COD
- Returns
- General jewellery questions

SILQY categories:
Bracelets, Chains, Rings, Watches, Earrings, Pendants, Jhumkas and Claw Clips.

Be friendly, elegant, concise and helpful.

IMPORTANT:
Never invent prices, stock availability, shipping charges,
order information or policies.

If information is unavailable, clearly say that a SILQY team
member can help.

Do not pretend to access Shopify orders or customer information.
`;

export default {
  async fetch(request, env) {

    if (request.method === "GET") {
      return new Response(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SILQY AI</title>
<style>
body{
  margin:0;
  font-family:Arial,sans-serif;
  background:#f8f5f0;
}
.header{
  background:#111;
  color:white;
  padding:20px;
  text-align:center;
}
.logo{
  font-size:28px;
  letter-spacing:6px;
}
.subtitle{
  font-size:11px;
  letter-spacing:3px;
  margin-top:6px;
}
#chat{
  height:65vh;
  overflow:auto;
  padding:18px;
}
.msg{
  padding:12px 15px;
  margin:10px 0;
  border-radius:18px;
  max-width:80%;
  line-height:1.4;
}
.user{
  background:#111;
  color:white;
  margin-left:auto;
}
.ai{
  background:white;
  color:#222;
}
.bottom{
  display:flex;
  padding:12px;
  background:white;
  gap:8px;
}
input{
  flex:1;
  padding:14px;
  border:1px solid #ddd;
  border-radius:25px;
  font-size:16px;
}
button{
  border:0;
  background:#111;
  color:white;
  padding:0 20px;
  border-radius:25px;
}
</style>
</head>

<body>

<div class="header">
  <div class="logo">SILQY</div>
  <div class="subtitle">AI SHOPPING ASSISTANT</div>
</div>

<div id="chat">
  <div class="msg ai">
    Hi! 👋 Welcome to SILQY. How can I help you today?
  </div>
</div>

<div class="bottom">
  <input id="input" placeholder="Ask SILQY AI..." />
  <button onclick="send()">Send</button>
</div>

<script>
let messages = [];

async function send(){

  const input = document.getElementById("input");
  const text = input.value.trim();

  if(!text) return;

  addMessage(text,"user");
  input.value="";

  const loading = addMessage("Thinking...","ai");

  try{

    const response = await fetch("/chat",{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        messages:[
          ...messages,
          {
            role:"user",
            content:text
          }
        ]
      })
    });

    const data = await response.json();

    loading.remove();

    addMessage(data.reply || "Sorry, I couldn't answer that.","ai");

    messages.push({
      role:"user",
      content:text
    });

    messages.push({
      role:"assistant",
      content:data.reply
    });

  }catch(error){

    loading.remove();
    addMessage("Sorry, something went wrong. Please try again.","ai");

  }
}

function addMessage(text,type){

  const chat=document.getElementById("chat");

  const div=document.createElement("div");
  div.className="msg "+type;
  div.textContent=text;

  chat.appendChild(div);
  chat.scrollTop=chat.scrollHeight;

  return div;
}
</script>

</body>
</html>
      `, {
        headers: {
          "Content-Type": "text/html"
        }
      });
    }

    if (request.method === "POST" && new URL(request.url).pathname === "/chat") {

      const body = await request.json();

      const messages = [
        {
          role: "system",
          content: SILQY_SYSTEM_PROMPT
        },
        ...(body.messages || [])
      ];

      const result = await env.AI.run(
        "@cf/meta/llama-3.2-3b-instruct",
        {
          messages
        }
      );

      return Response.json({
        reply: result.response
      });
    }

    return new Response("SILQY AI is running.");
  }
};
