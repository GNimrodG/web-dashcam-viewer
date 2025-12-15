import { useColorScheme } from "@mui/joy/styles";
import IconButton, { IconButtonProps } from "@mui/joy/IconButton";

import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeIcon from "@mui/icons-material/LightMode";
import { useEffect, useState } from "react";

export default function ColorSchemeToggle(props: IconButtonProps) {
  const { onClick, sx, ...other } = props;
  const { mode, setMode } = useColorScheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return (
      <IconButton
        size="sm"
        variant="outlined"
        color="neutral"
        {...other}
        sx={sx}
        disabled
      />
    );
  }
  return (
    <IconButton
      data-screenshot="toggle-mode"
      size="sm"
      variant="outlined"
      color="neutral"
      {...other}
      onClick={(event) => {
        if (mode === "light") {
          setMode("dark");
        } else {
          setMode("light");
        }
        onClick?.(event);
      }}
      sx={[
        mode === "dark"
          ? { "& > *:first-of-type": { display: "none" } }
          : { "& > *:first-of-type": { display: "initial" } },
        mode === "light"
          ? { "& > *:last-child": { display: "none" } }
          : { "& > *:last-child": { display: "initial" } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}>
      <DarkModeRoundedIcon />
      <LightModeIcon />
    </IconButton>
  );
}
