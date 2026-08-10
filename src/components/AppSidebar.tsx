import { useAuth } from '@/contexts/AuthContext';
import { NavLink } from '@/components/NavLink';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import {
  BookOpen, ClipboardList, Monitor, Users, BarChart3,
  AlertTriangle, Home, CheckSquare, UserCog, Settings, ScanFace, Video,
} from 'lucide-react';

const menuConfig = {
  applicant: [
    { title: '마이페이지', url: '/applicant', icon: Home },
  ],
  examiner: [
    { title: '실시간 모니터링', url: '/examiner/monitor', icon: Monitor },
    { title: '이벤트 로그', url: '/examiner/events', icon: AlertTriangle },
  ],
  org_admin: [
    { title: '시험 관리', url: '/admin/exams', icon: ClipboardList },
    { title: '문제은행', url: '/admin/questions', icon: BookOpen },
    { title: '실시간 모니터링', url: '/examiner/monitor', icon: Monitor },
    { title: '이벤트 로그', url: '/examiner/events', icon: AlertTriangle },
    { title: '녹화 조회', url: '/admin/recordings', icon: Video },
    { title: '채점 관리', url: '/admin/grading', icon: CheckSquare },
    { title: '멤버 · 초대', url: '/admin/members', icon: UserCog },
    { title: '인증자 DB', url: '/admin/certifications', icon: Users },
    { title: '통계', url: '/admin/stats', icon: BarChart3 },
    { title: '시스템 설정', url: '/admin/settings', icon: Settings },
    { title: 'Face++ 테스트', url: '/admin/facepp-test', icon: ScanFace },
  ],
  viewer: [
    { title: '인증자 조회', url: '/admin/certifications', icon: Users },
    { title: '통계', url: '/admin/stats', icon: BarChart3 },
  ],
};

const roleLabels = { applicant: '응시자', examiner: '감독관', org_owner: '소유자', org_admin: '관리자', viewer: '조회자' };

export function AppSidebar() {
  const { role } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  // org_owner 는 org_admin 의 메뉴를 그대로 쓴다(권한도 포함 관계).
  const items = menuConfig[role === 'org_owner' ? 'org_admin' : role] || [];

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider">
            {!collapsed && roleLabels[role]}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/applicant'}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span className="text-[13px]">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
