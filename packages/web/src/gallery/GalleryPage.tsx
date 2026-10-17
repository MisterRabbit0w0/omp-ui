import {
  Copy,
  GitBranch,
  Minimize2,
  Moon,
  MoreHorizontal,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "../app/theme";
import { useAppStore } from "../store/app-store";
import { Banner } from "../ui/Banner";
import { Button, IconButton } from "../ui/Button";
import { Card, CardBar, CardFooter } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { Chip, Kbd, Pill, StatusBadge } from "../ui/Chip";
import { Collapsible } from "../ui/Collapsible";
import { Dialog, DialogContent, DialogTrigger } from "../ui/Dialog";
import { Icon, SparkleIcon, TOOL_ICONS } from "../ui/Icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "../ui/Menu";
import { PixelGrid } from "../ui/PixelGrid";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { ShimmerText } from "../ui/ShimmerText";
import { Spinner, SpinnerRing } from "../ui/Spinner";
import { Switch } from "../ui/Switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { Toaster, toast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { useSlidingHighlight } from "../ui/sliding-highlight";
import ComposerGallerySection from "./sections/Composer";
import PanelGallerySection from "./sections/Panel";
import ShellGallerySection from "./sections/Shell";
import TranscriptGallerySection from "./sections/Transcript";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function SlidingHighlightDemo() {
  const hl = useSlidingHighlight<HTMLDivElement>({ variant: "list" });
  const rows = ["整理会话树结构", "修复 gallery 的暗色对比", "审查未提交的改动"];
  return (
    <div
      ref={hl.containerRef}
      onPointerOver={hl.onPointerOver}
      onFocus={hl.onFocus}
      onPointerLeave={hl.onPointerLeave}
      className="relative"
    >
      {hl.highlightBlock}
      {rows.map((r, i) => (
        <button
          key={r}
          type="button"
          data-hl-item=""
          {...(i === 1 ? { "data-hl-active": "" } : {})}
          className={
            "relative z-10 flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] " +
            (i === 1 ? "bg-hover-2 font-medium text-ink" : "text-ink-2")
          }
        >
          <span className="w-3.5">{i === 0 && <PixelGrid mode="drive" size="sm" />}</span>
          <span className="min-w-0 flex-1 truncate">{r}</span>
          <span className="text-[11.5px] text-ink-2">2 小时前</span>
        </button>
      ))}
    </div>
  );
}

export function GalleryPage() {
  const { theme, resolved, cycleTheme } = useTheme();
  const [open, setOpen] = useState(true);
  const [sw, setSw] = useState(true);
  const [cb, setCb] = useState(true);
  const [tab, setTab] = useState("todo");

  useEffect(() => {
    useAppStore.setState({
      answerUi: (sessionId, response) => {
        useAppStore.setState(prev => {
          const v = prev.views[sessionId];
          if (!v) return prev;
          return {
            views: {
              ...prev.views,
              [sessionId]: { ...v, pendingUi: v.pendingUi.filter(r => r.id !== response.id) },
            },
          };
        });
      },
      approve: (sessionId, requestId) => {
        useAppStore.setState(prev => {
          const v = prev.views[sessionId];
          if (!v) return prev;
          return {
            views: {
              ...prev.views,
              [sessionId]: { ...v, pendingUi: v.pendingUi.filter(r => r.id !== requestId) },
            },
          };
        });
      },
    });
  }, []);
  return (
    <div className="h-full overflow-auto bg-app-main">
      <div className="mx-auto grid max-w-[1080px] grid-cols-2 gap-5 px-6 pt-10 pb-16">
        <div className="col-span-2 flex items-center justify-between">
          <h1 className="text-[18px] font-semibold">组件库</h1>
          <Button variant="secondary" size="sm" onClick={cycleTheme}
            icon={resolved === "dark" ? <Sun size={13} strokeWidth={2} /> : <Moon size={13} strokeWidth={2} />}>
            {theme}（{resolved}）
          </Button>
        </div>

        <Section title="按钮 Button">
          <Row>
            <Button variant="primary">允许 <Kbd tone="onInk">Enter</Kbd></Button>
            <Button variant="secondary">拒绝 <Kbd>Esc</Kbd></Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">删除</Button>
            <Button variant="secondary" loading icon={<Copy size={13} strokeWidth={2} />}>复制</Button>
            <Button variant="secondary" disabled>禁用</Button>
          </Row>
          <Row>
            <Button size="sm" variant="primary">Small</Button>
            <Button size="sm" variant="secondary" icon={<Copy size={11} strokeWidth={2} />}>复制</Button>
            <Button size="sm" variant="ghost">取消重试</Button>
          </Row>
        </Section>

        <Section title="图标按钮 IconButton">
          <Row>
            <IconButton label="更多"><MoreHorizontal size={15} strokeWidth={2.4} /></IconButton>
            <IconButton label="重试" size="sm"><RotateCcw size={13} strokeWidth={2} /></IconButton>
            <IconButton label="禁用" disabled><X size={15} strokeWidth={1.8} /></IconButton>
            <Tooltip content="复制" kbd="Ctrl C"><IconButton label="复制"><Copy size={15} strokeWidth={1.8} /></IconButton></Tooltip>
          </Row>
        </Section>

        <Section title="Chip / Pill / Kbd">
          <Row>
            <Chip>status: running</Chip>
            <Chip mono icon={<Icon icon={TOOL_ICONS.read!} />}>packages/web/src/main.tsx</Chip>
            <Pill tone="green">完成</Pill>
            <Pill tone="red">失败</Pill>
            <Pill tone="orange">等待审批</Pill>
            <Pill tone="accent">推荐</Pill>
            <Pill tone="neutral">草稿</Pill>
            <Kbd>Ctrl K</Kbd>
          </Row>
        </Section>

        <Section title="状态位 Status">
          <Row>
            <StatusBadge status="success" />
            <StatusBadge status="error" />
            <StatusBadge status="aborted" />
            <Spinner />
            <SpinnerRing active index={1} />
            <SpinnerRing index={2} />
            <PixelGrid mode="drive" />
            <PixelGrid mode="orbit" />
            <PixelGrid mode="dots" />
            <PixelGrid mode="drive" static />
            <ShimmerText>思考中</ShimmerText>
            <ShimmerText active={false}>思考了 7 秒</ShimmerText>
            <SparkleIcon className="text-ink-3" />
          </Row>
        </Section>

        <Section title="卡片 Card">
          <Card>
            <CardBar>
              <span className="font-mono text-[12px] font-medium">process.ts <span className="font-sans text-[11.5px] font-normal text-ink-2">TypeScript</span></span>
              <Button size="sm" variant="ghost" icon={<Copy size={11} strokeWidth={2} />}>复制</Button>
            </CardBar>
            <div className="bg-inset p-3 font-mono text-[12.5px] leading-[1.7]">
              <span className="text-accent-ink">export class</span> <span className="text-ink">OmpProcess</span>
            </div>
            <CardFooter>
              <span className="text-[12px] text-ink-2">底栏 10px</span>
              <Button size="sm" variant="secondary">重试</Button>
            </CardFooter>
          </Card>
        </Section>

        <Section title="折叠 Collapsible">
          <Card>
            <button type="button" onClick={() => setOpen(!open)}
              className="flex w-full items-center gap-2 rounded-card px-3 py-2.5 text-left text-[12.5px] font-medium text-ink hover:bg-hover-2">
              <Sparkles size={14} strokeWidth={1.8} className="text-ink-3" />
              展开/折叠（grid-rows 300ms）
            </button>
            <Collapsible open={open}>
              <div className="border-t border-line px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                内层 overflow-hidden，外层 grid-template-rows 0fr ↔ 1fr，从不给 height 做动画。
              </div>
            </Collapsible>
          </Card>
        </Section>

        <Section title="菜单 Menu">
          <Row>
            <Menu>
              <MenuTrigger asChild><Button variant="secondary" size="sm">⋯ 菜单</Button></MenuTrigger>
              <MenuContent footer="↑↓ 选择 · Enter 确认 · Esc 关闭">
                <MenuItem icon={<Minimize2 size={15} strokeWidth={1.8} />} kbd="C">压缩上下文</MenuItem>
                <MenuItem icon={<GitBranch size={15} strokeWidth={1.8} />}>分叉为新会话</MenuItem>
                <MenuSeparator />
                <MenuLabel>危险区</MenuLabel>
                <MenuItem danger icon={<X size={15} strokeWidth={1.8} />} kbd="⌫">删除会话</MenuItem>
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger asChild><Button variant="secondary" size="sm">Slash 菜单（36px 行）</Button></MenuTrigger>
              <MenuContent width={320} footer="↑↓ 选择 · Enter 确认 · Esc 关闭">
                <MenuItem icon={<Minimize2 size={15} strokeWidth={1.8} />} description="压缩当前上下文" source="内置">/compact</MenuItem>
                <MenuItem icon={<GitBranch size={15} strokeWidth={1.8} />} description="从当前位置分叉为新会话" source="内置">/fork</MenuItem>
                <MenuItem icon={<ShieldAlert size={14} strokeWidth={2} />} description="计划、运行、比较安全扫描" source="扩展">/security</MenuItem>
                <MenuItem icon={<Sparkles size={15} strokeWidth={1.8} />} description="生成提交信息并更新 changelog" source="技能">/commit</MenuItem>
              </MenuContent>
            </Menu>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <span className="grid h-16 flex-1 place-items-center rounded-card bg-field text-[12px] text-ink-2 shadow-hairline">右键这里（ContextMenu）</span>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <MenuItem icon={<Copy size={15} strokeWidth={1.8} />} kbd="Ctrl C">复制</MenuItem>
                <MenuItem danger icon={<X size={15} strokeWidth={1.8} />}>删除</MenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </Row>
        </Section>

        <Section title="滑动高亮 SlidingHighlight">
          <SlidingHighlightDemo />
        </Section>

        <Section title="对话框 Dialog / Popover">
          <Row>
            <Dialog>
              <DialogTrigger asChild><Button variant="secondary" size="sm">删除确认</Button></DialogTrigger>
              <DialogContent
                title="删除这个会话？"
                description="会移到回收目录，30 天后清除。"
                footer={<><DialogTrigger asChild><Button variant="secondary">取消</Button></DialogTrigger><Button variant="danger">删除</Button></>}
              >
                <div className="mt-2.5 rounded-control bg-inset p-2.5 font-mono text-[11px] text-ink-2 shadow-hairline">
                  ~/.omp/agent/sessions/-Desktop-code/2026-10-16_01a1….jsonl
                </div>
              </DialogContent>
            </Dialog>
            <Popover>
              <PopoverTrigger asChild><Button variant="secondary" size="sm">上下文环 popover</Button></PopoverTrigger>
              <PopoverContent>
                <div className="w-44 text-[12px] text-ink-2">
                  <div className="flex justify-between"><span>tokens</span><span className="font-mono text-ink">182k / 200k</span></div>
                  <div className="mt-2"><Button size="sm" variant="secondary">压缩</Button></div>
                </div>
              </PopoverContent>
            </Popover>
          </Row>
        </Section>

        <Section title="Switch / Checkbox / Tabs">
          <Row>
            <Switch checked={sw} onCheckedChange={setSw} label="fast mode" />
            <Switch checked={false} label="off" />
            <Switch checked={false} disabled label="disabled" />
            <Checkbox checked={cb} onCheckedChange={setCb} label="本会话总是允许 bash" id="cb1" />
            <Checkbox checked={false} label="未选" id="cb2" />
          </Row>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="todo">待办</TabsTrigger>
              <TabsTrigger value="agents" dot>子代理</TabsTrigger>
              <TabsTrigger value="changes">变更</TabsTrigger>
              <TabsTrigger value="goal">目标</TabsTrigger>
              <TabsTrigger value="info">信息</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="px-1.5 text-[12px] text-ink-2">当前 tab：{tab}</TabsContent>
          </Tabs>
        </Section>

        <Section title="横幅 Banner">
          <div className="flex flex-col gap-2">
            <Banner variant="retry" icon={<RotateCcw size={15} strokeWidth={1.8} />} title="重试 2/5"
              action={<Button size="sm" variant="ghost">取消重试</Button>}>
              429 rate limited，<span className="font-mono tabular-nums">4s</span> 后重试
            </Banner>
            <Banner variant="error" icon={<X size={14} strokeWidth={2.2} />} title="请求失败"
              action={<Button size="sm" variant="secondary">重试</Button>}>
              <span className="font-mono text-[11.5px] text-ink-2">anthropic · opus-5.5 · HTTP 529</span>
            </Banner>
            <Banner variant="neutral" title="会话进程已退出（代码 1）"
              action={<Button size="sm" variant="primary">恢复</Button>} />
          </div>
        </Section>

        <Section title="通知 Toast">
          <Row>
            <Button size="sm" variant="secondary" onClick={() => toast("已回退到 sonnet-5（opus 过载）", "success")}>success toast</Button>
            <Button size="sm" variant="secondary" onClick={() => toast("已复制到剪贴板", "info")}>info toast</Button>
            <Button size="sm" variant="secondary" onClick={() => toast("连接 omp 失败：进程已退出", "error")}>error toast（不自动消失）</Button>
          </Row>
        </Section>

        <Section title="工具图标 TOOL_ICONS">
          <Row>
            {Object.entries(TOOL_ICONS).map(([name, ic]) => (
              <Tooltip key={name} content={name}>
                <span className="grid size-7 place-items-center rounded-control text-ink-3 hover:bg-hover-2 hover:text-ink-2">
                  <Icon icon={ic} />
                </span>
              </Tooltip>
            ))}
          </Row>
        </Section>

        <ShellGallerySection />
        <div className="col-span-2 border-t border-line pt-6">
          <TranscriptGallerySection />
        </div>
        <ComposerGallerySection />
        <PanelGallerySection />
      </div>
      <Toaster />
    </div>
  );
}
