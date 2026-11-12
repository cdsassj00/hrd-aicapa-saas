import { useAuth } from '@/contexts/AuthContext';
import { NavLink } from '@/components/NavLink';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import {
  BookOpen, ClipboardList, Monitor, Users, BarChart3, type LucideIcon,
  AlertTriangle, Home, LayoutDashboard, CheckSquare, UserCog, Settings, ScanFace, Video, Shield, CreditCard, PlayCircle,
} from 'lucide-react';

type Item = { title: string; url: string; icon: LucideIcon };
type Group = { label: string; items: Item[] };

// 역할별 메뉴. 관리자는 업무 흐름(출제·운영 → 채점·결과 → 조직) 순으로 묶는다.
const menuConfig: Record<string, Group[]> = {
  applicant: [
    { label: '응시자', items: [{ title: '마이페이지', url: '/applicant', icon: Home }] },
  ],
  examiner: [
    { label: '감독', items: [
      { title: '실시간 모니터링', url: '/examiner/monitor', icon: Monitor },
      { title: '이벤트 로그', url: '/examiner/events', icon: AlertTriangle },
    ] },
  ],
  org_admin: [
    { label: '개요', items: [
      { title: '대시보드', url: '/admin', icon: LayoutDashboard },
    ] },
    { label: '출제 · 운영', items: [
      { title: '시험 관리', url: '/admin/exams', icon: ClipboardList },
      { title: '문제은행', url: '/admin/questions', icon: BookOpen },
      { title: '실시간 모니터링', url: '/examiner/monitor', icon: Monitor },
      { title: '이벤트 로그', url: '/examiner/events', icon: AlertTriangle },
      { title: '녹화 조회', url: '/admin/recordings', icon: Video },
    ] },
    { label: '채점 · 결과', items: [
      { title: '채점 관리', url: '/admin/grading', icon: CheckSquare },
      { title: '인증자 DB', url: '/admin/certifications', icon: Users },
      { title: '통계', url: '/admin/stats', icon: BarChart3 },
    ] },
    { label: '조직', items: [
      { title: '멤버 · 초대', url: '/admin/members', icon: UserCog },
      { title: '구독 · 결제', url: '/admin/billing', icon: CreditCard },
      { title: '시스템 설정', url: '/admin/settings', icon: Settings },
    ] },
    { label: '도구', items: [
      // 관리자가 응시자 화면을 직접 체험(테스트 모드 회차는 응시권 차감 없음)
      { title: '응시자 화면 체험', url: '/applicant', icon: PlayCircle },
      { title: '얼굴 대조 테스트', url: '/admin/face-compare-test', icon: ScanFace },
    ] },
  ],
  viewer: [
    { label: '조회', items: [
      { title: '인증자 조회', url: '/admin/certifications', icon: Users },
      { title: '통계', url: '/admin/stats', icon: BarChart3 },
    ] },
  ],
};

const roleLabels: Record<string, string> = { applicant: '응시자', examiner: '감독관', org_owner: '소유자', org_admin: '관리자', viewer: '조회자' };

function MenuGroup({ group, collapsed }: { group: Group; collapsed: boolean }) {
  return (
    <SidebarGroup className="py-1">
      {!collapsed && (
        <SidebarGroupLabel className="h-7 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {group.label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {group.items.map((item) => (
            <SidebarMenuItem key={item.url + item.title}>
              <SidebarMenuButton asChild tooltip={item.title} className="h-8 rounded-lg px-3 transition-colors">
                <NavLink
                  to={item.url}
                  end={item.url === '/applicant' || item.url === '/admin'}
                  className="text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                  activeClassName="bg-sidebar-accent text-foreground font-medium shadow-sm"
                >
                  <item.icon className="mr-2.5 h-4 w-4 shrink-0" />
                  {!collapsed && <span className="text-[13px] tracking-[-0.01em]">{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { role, isPlatformAdmin, activeOrg } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  // org_owner 는 org_admin 의 메뉴를 그대로 쓴다(권한도 포함 관계).
  const groups = menuConfig[role === 'org_owner' ? 'org_admin' : role] || [];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/60">
      <SidebarContent className="px-2 pt-3">
        {!collapsed && activeOrg && (
          <div className="mx-1 mb-2 rounded-lg border bg-background/60 px-3 py-2.5">
            <div className="truncate text-[13px] font-semibold">{activeOrg.orgName}</div>
            <div className="text-[11px] text-muted-foreground">{roleLabels[role] ?? role}</div>
          </div>
        )}
        {groups.map((g) => <MenuGroup key={g.label} group={g} collapsed={collapsed} />)}
        {isPlatformAdmin && (
          <MenuGroup collapsed={collapsed} group={{ label: '플랫폼', items: [{ title: '플랫폼 관리', url: '/platform', icon: Shield }] }} />
        )}
      </SidebarContent>
    </Sidebar>
  );
}
