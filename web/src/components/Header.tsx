import GlobalStyles from "@mui/joy/GlobalStyles";
import IconButton from "@mui/joy/IconButton";
import Sheet from "@mui/joy/Sheet";
import Button from "@mui/joy/Button";
import Typography from "@mui/joy/Typography";
import { type FunctionComponent, useEffect, useState } from "react";
import MenuIcon from "@mui/icons-material/Menu";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import { toggleSidebar } from "../utils";
import { getCurrentUser, loginUrl, logout, type User } from "../api";

const Header: FunctionComponent = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  return (
    <Sheet
      sx={{
        display: { xs: "flex", md: "none" },
        alignItems: "center",
        justifyContent: "space-between",
        position: "fixed",
        top: 0,
        width: "100vw",
        height: "var(--Header-height)",
        zIndex: 9995,
        p: 2,
        gap: 1,
        borderBottom: "1px solid",
        borderColor: "background.level1",
        boxShadow: "sm",
      }}>
      <GlobalStyles
        styles={(theme) => ({
          ":root": {
            "--Header-height": "52px",
            [theme.breakpoints.up("md")]: {
              "--Header-height": "0px",
            },
          },
        })}
      />
      <IconButton
        onClick={() => toggleSidebar()}
        variant="outlined"
        color="neutral"
        size="sm">
        <MenuIcon />
      </IconButton>
      
      {user ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Typography level="body-sm">{user.name || user.email}</Typography>
          <IconButton size="sm" variant="plain" onClick={handleLogout}>
            <LogoutIcon />
          </IconButton>
        </div>
      ) : (
        <Button
          size="sm"
          variant="plain"
          startDecorator={<LoginIcon />}
          component="a"
          href={loginUrl()}>
          Login
        </Button>
      )}
    </Sheet>
  );
};

export default Header;
