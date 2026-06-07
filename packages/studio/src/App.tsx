import SessionSidebar from "./components/chat/SessionSidebar";
import ChatArea from "./components/chat/ChatArea";

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface text-gray-100">
      {/* Deep ocean gradient mesh */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-[20%] -top-[30%] h-[70vh] w-[70vh] rounded-full bg-cyan-500/[0.03] blur-[100px]" />
        <div className="absolute -bottom-[20%] -right-[15%] h-[60vh] w-[60vh] rounded-full bg-teal-400/[0.025] blur-[80px]" />
        <div className="absolute bottom-[10%] left-[40%] h-[40vh] w-[40vh] rounded-full bg-purple-500/[0.02] blur-[90px]" />
      </div>

      {/* Sidebar with brand */}
      <div className="relative z-20 flex flex-col">
        {/* Brand header */}
        <div className="glass-panel-strong border-b border-white/[0.04] px-5 py-5">
          <div className="flex items-baseline gap-2">
            <span className="bg-gradient-to-r from-cyan-300 to-teal-300 bg-clip-text text-lg font-bold tracking-tight text-transparent text-glow">
              Proteus
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-500/40">
              Studio
            </span>
          </div>
        </div>
        <SessionSidebar />
      </div>

      {/* Main chat area */}
      <main className="relative z-10 flex-1 overflow-auto">
        <ChatArea />
      </main>
    </div>
  );
}
